import FS from 'fs';
import Path from 'path';
import URL from 'url';
import Util from 'util';
import _ from 'lodash';
import Faker from 'faker';
import YAML from 'yamljs';
import Inflected from 'inflected';

const infoKeys = [
  'info.title',
  'info.description',
  'info.version',
  'formats',
  'baseUri',
  'schemes'
];

const dataTypes = {
  string: {
    type: 'string',
    example: 'random.word'
  },
  integer: {
    type: 'number',
    example: 'random.number'
  },
  uuid: {
    type: 'string',
    validator: 'string.guid',
    example: 'random.uuid'
  },
  url: {
    type: 'string',
    validator: 'string.uri',
    example: 'internet.url'
  }
};

const methods = {
  list: {
    method: 'get',
    collection: true,
    modify: false,
    description: 'Return a list of %s'
  },
  create: {
    method: 'post',
    collection: true,
    modify: true,
    description: 'Create a new %s'
  },
  read: {
    method: 'get',
    collection: false,
    modify: false,
    description: 'Return a %s'
  },
  update: {
    method: 'put',
    collection: false,
    modify: true,
    description: 'Update a %s'
  },
  delete: {
    method: 'delete',
    collection: false,
    modify: false,
    description: 'Delete a %s'
  }
};

class Model {
  constructor(swagger, name, attributes, options) {
    this._swagger = swagger;
    this._name = name;
    this._attributes = attributes;
    this._options = options || {};
  }

  get swagger() {
    return this._swagger;
  }

  get name() {
    return this._name;
  }

  get attributes() {
    return this._attributes;
  }

  get options() {
    return this._options;
  }

  get methods() {
    return _.get(this.attributes, 'methods', Object.keys(methods));
  }

  get isReadOnly() {
    return _.get(this.attributes, 'readOnly', false)
      || _.filter(_.pick(methods, this.methods), { modify: true }).length === 0;
  }

  get includeExamples() {
    return _.get(this.options, 'examples', true);
  }

  get includeValidators() {
    return _.get(this.options, 'validators', true);
  }

  get includeApiGateway() {
    return _.get(this.options, 'apiGateway', false);
  }

  get definitions() {
    const defs = {};

    // Write out response def regardless
    let defKey = Util.format('%sResponse', Inflected.capitalize(this.name));
    defs[defKey] = this.generateDefinition(this.attributes.response);

    // Only write out modify def if we have modify endpoints for this resource
    if (!this.isReadOnly) {
      defKey = Util.format('%sModify', Inflected.capitalize(this.name));
      defs[defKey] = this.generateDefinition(this.attributes.modify);
    }

    return defs;
  }

  get paths() {
    const paths = {};

    // Setup the collection & resource hashes for good time-y action
    let path = this.parsedPathForMethod({ collection: true }).untypedPath;
    paths[path] = {
      'x-kraken-collection': Inflected.capitalize(this.name)
    };

    path = this.parsedPathForMethod({ collection: false }).untypedPath;
    paths[path] = {
      'x-kraken-collection': Inflected.capitalize(this.name)
    };

    _.forEach(_.pick(methods, this.methods), (method, operation) => {
      const parsedPath = this.parsedPathForMethod(method).untypedPath;

      paths[parsedPath][method.method] = this.generatePath(operation, method);
    });

    return paths;
  }

  dataTypeForType(type) {
    const defaultType = {
      type,
      validator: false,
      example: Util.format('random.%s', type)
    };

    return _.get(dataTypes, type, defaultType);
  }

  parsedPathForMethod(method) {
    let path = this.attributes.path;

    // If the method is a collection, nuke the last portion containing the {id}
    if (method.collection) {
      path = Util.format('/%s', path.replace(/^\/|\/$/g, '').split('/').slice(0, -1).join('/'));
    }

    // Creates the path sans type hinting ex: /organizations/{organizationId}/roaming-devices
    const untypedPath = path.split('/').map((piece) => {
      if (piece.indexOf(':') !== 1) {
        piece = piece.replace(/\:.*\}/, '}');
      }

      return piece;
    }).join('/');

    // Get the param types out of the URL
    const params = _.fromPairs((path.match(/\{([^\/]+)\}/g) || []).map((match) => {
      match = match.substring(1, match.length - 1);

      return match.split(':');
    }));

    return { path, untypedPath, params };
  }

  generateDefinition(properties) {
    const parsedProperties = this.generateParsedProperties(properties);

    // Pick out required fields
    const required = Object.keys(
      _.pickBy(parsedProperties, { required: true })
    );

    // Generate a hash of properties
    const props = _.chain(parsedProperties)
      .map((attributes, property) => {
        const dataType = this.dataTypeForType(attributes.type);

        const prop = {
          type: dataType.type,
          description: _.get(
            attributes,
            'description',
            Util.format(
              'The %s of the %s',
              Inflected.underscore(property).replace(/_/g, ' '),
              Inflected.titleize(this.name)
            )
          )
        };

        // If we are allowed to include examples, do so!
        if (this.includeExamples) {
          prop.example = attributes.example || (_.get(Faker, dataType.example, () => {})());
        }

        // If we are allowed to include validators, do so!
        if (this.includeValidators && dataType.validator) {
          prop['x-kraken-validator'] = dataType.validator;
        }

        // Return a paired array that we will flip to object
        return [
          property,
          prop
        ];
      })
      .fromPairs()
      .value();

    return {
      required,
      type: 'object',
      properties: props
    };
  }

  generatePath(method, attributes) {
    let schema = {
      $ref: Util.format('#/definitions/%sResponse', Inflected.camelize(this.name))
    };

    // If we're returning multiple items, schema shall be an array
    if (attributes.method === 'get' && attributes.collection) {
      schema = {
        type: 'array',
        items: {
          $ref: Util.format('#/definitions/%sResponse', Inflected.camelize(this.name))
        }
      };
    }

    const description = Util.format.call(
      null,
      attributes.description,
      Inflected.titleize(this.name)
    );

    const path = {
      description,
      operationId: method,
      parameters: this.generatePathParameters(attributes),
      responses: {
        200: { description, schema }
      }
    };

    if (this.includeApiGateway) {
      const basePath = this.swagger.manifest.basePath.replace(/^\/?([^\/]*)\/?$/, '$1');
      const parsedPath = this.parsedPathForMethod(attributes);
      const pathName = _.isEmpty(basePath) ?
        parsedPath.untypedPath :
        [basePath, parsedPath.untypedPath].join('/');

      path['x-amazon-apigateway-integration'] = {
        type: 'http',
        uri: URL.format({
          protocol: this.swagger.manifest.schemes[0],
          host: this.swagger.kraken.baseUri,
          pathname: pathName
        }),
        httpMethod: attributes.method,
        requestParameters: _.fromPairs(_.map(
          parsedPath.params,
          (type, name) => {
            const source = Util.format('method.request.path.%s', name);
            const dest = Util.format('integration.request.path.%s', name);

            return [dest, source];
          }
        )),
        requestTemplates: this.generateRequestVtl(attributes),
        responses: {
          '2\\d{2}': {
            statusCode: 200
          }
        }
      };
    }

    return path;
  }

  generatePathParameters(method) {
    const path = this.parsedPathForMethod(method);

    const params = _.map(path.params, (type, key) => {
      const description = Util.format(
        'The %s related to this %s',
        Inflected.underscore(key).replace(/_/g, ' '),
        Inflected.titleize(this.name)
      );

      return {
        type,
        description,
        name: key,
        in: 'path',
        required: true
      };
    });

    if (method.modify) {
      const description = Util.format(
        'The new %s you want to create', Inflected.titleize(this.name)
      );

      params.push({
        description,
        name: 'payload',
        in: 'body',
        schema: {
          $ref: Util.format('#/definitions/%sModify', Inflected.camelize(this.name))
        }
      });
    }

    return params;
  }

  generateParsedProperties(properties) {
    const propertyTemplate = {
      required: true,
      example: false,
      validator: false
    };

    return _.chain(properties)
    .map((property, field) => {
      if (_.isString(property)) {
        const type = property;

        property = _.merge(_.cloneDeep(propertyTemplate), {
          type: type
        });
      } else {
        property = _.merge(_.cloneDeep(propertyTemplate), property);
      }

      if (_.endsWith(field, '?')) {
        property.required = false;
        field = _.trimEnd(field, '?');
      }

      return [field, property];
    })
    .fromPairs()
    .value();
  }

  generateRequestVtl() {
    return {
      'application/json': JSON.stringify({
        resourcePath: '$context.resourcePath',
        httpMethod: '$context.httpMethod',
        queryParams: {
          filters: '$util.base64Encode($input.params().querystring.filters)'
        }
      })
    };
  }

  generateResponseVtl() {
    return {
      'application/json': '#set ($root=$input.path("$")) { "id": $root.id }'
    };
  }
}

export default class Swagger {
  constructor(krakenOrPath) {
    if (_.isString(krakenOrPath)) {
      krakenOrPath = YAML.load(krakenOrPath);
    }

    this._kraken = krakenOrPath;
    this._manifest = YAML.load(Path.join(__dirname, '../templates/swagger.yaml'));

    this.setupInfoProperties();

    infoKeys.forEach((key) => {
      key = key.split('.').pop();

      this[key] = this.kraken[key];
    });
  }

  get kraken() {
    return this._kraken;
  }

  get manifest() {
    return this._manifest;
  }

  set formats(formats) {
    this.manifest.consumes = this.manifest.produces = [].concat(formats);
  }

  set baseUri(uri) {
    const parsed = URL.parse(Util.format(
      '%s://%s',
      this.manifest.schemes[0],
      uri
    ));

    this.manifest.host = parsed.hostname;
    this.manifest.basePath = parsed.pathname;
  }

  generate(options) {
    _.forEach(this.kraken.models, (def, name) => {
      const model = new Model(this, name, def, options);

      this.manifest.definitions = _.merge(this.manifest.definitions, model.definitions);
      this.manifest.paths = _.merge(this.manifest.paths, model.paths);
    });

    return this.manifest;
  }

  generateAndWrite(outputPath, options) {
    const output = this.generate(options);

    const ext = Path.extname(outputPath);

    switch (ext) {
      case '.json':
        FS.writeFileSync(outputPath, JSON.stringify(output, null, 4));
        break;

      case '.yaml':
        FS.writeFileSync(outputPath, YAML.stringify(output, 24, 2));
        break;

      default:
        throw new RangeError('Output path must be suffixed with either .json or .yaml');
    }
  }

  setupInfoProperties() {
    infoKeys.forEach((key) => {
      if ([
        'baseUri',
        'formats'
      ].indexOf(key) !== -1) {
        return;
      }

      Object.defineProperty(this, key.split('.').pop(), {
        set: (val) => {
          _.set(this.manifest, key, val);
        }
      });
    });
  }
}

Swagger.Model = Model;

Swagger.DataTypes = dataTypes;
Swagger.Methods = methods;
