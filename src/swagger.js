import FS from 'fs';
import Path from 'path';
import Util from 'Util';
import _ from 'lodash';
import Faker from 'faker';
import YAML from 'yamljs';
import Inflected from 'inflected';

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
  constructor(name, attributes, options) {
    this._name = name;
    this._attributes = attributes;
    this._options = options;
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

  get definitions() {
    let defs = {};

    // Write out response def regardless
    defs[Util.format('%sResponse', Inflected.capitalize(this.name))] = this.generateDefinition(this.attributes.response);

    // Only write out modify def if we have modify endpoints for this resource
    if (!this.isReadOnly) {
      defs[Util.format('%sModify', Inflected.capitalize(this.name))] = this.generateDefinition(this.attributes.modify);
    }

    return defs;
  }

  get paths() {
    let paths = {};

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
      let path = this.parsedPathForMethod(method).untypedPath;

      paths[path][method.method] = this.generatePath(operation, method);
    });

    return paths;
  }

  dataTypeForType(type) {
    const defaultType = {
      type: type,
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

    return {
      path: path,
      untypedPath: untypedPath,
      params: params,
    };
  }

  generateDefinition(properties) {

    // Pick out required fields
    const required = Object.keys(
      _.pickBy(properties, { required: true })
    );

    // Generate a hash of properties
    const props = _.chain(properties)
      .map((attributes, property) => {
        const dataType = this.dataTypeForType(attributes.type);

        let prop = {
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
      type: 'object',
      required: required,
      properties: props
    };
  }

  generatePath(method, attributes) {
    let schema = {
      '$ref': Util.format('#/definitions/%sResponse', Inflected.camelize(this.name))
    };

    // If we're returning multiple items, schema shall be an array
    if (attributes.method === 'get' && attributes.collection) {
      schema = {
        type: 'array',
        items: {
          '$ref': Util.format('#/definitions/%sResponse', Inflected.camelize(this.name))
        }
      };
    }

    const description = Util.format.call(null, attributes.description, Inflected.titleize(this.name));

    return {
      description: description,
      operationId: method,
      parameters: this.generatePathParameters(attributes),
      responses: {
        '200': {
          description: description,
          schema: schema
        }
      }
    };
  }

  generatePathParameters(method) {
    const path = this.parsedPathForMethod(method);

    let params = _.map(path.params, (type, key) => {
      return {
        name: key,
        in: 'path',
        type: type,
        description: Util.format('The %s related to this %s', Inflected.underscore(key).replace(/_/g, ' '), Inflected.titleize(this.name)),
        required: true
      };
    });

    if (method.modify) {
      params.push({
        name: 'payload',
        in: 'body',
        description: Util.format('The new %s you want to create', Inflected.titleize(this.name)),
        schema: {
          '$ref': Util.format('#/definitions/%sModify', Inflected.camelize(this.name))
        }
      });
    }

    return params;
  }
}

export default class Swagger {
  constructor(krakenOrPath) {
    if (_.isString(krakenOrPath)) {
      krakenOrPath = YAML.load(krakenOrPath);
    }

    this._kraken = krakenOrPath;
    this._manifest = YAML.load(Path.join(__dirname, '../templates/swagger.yaml'));
  }

  get kraken() {
    return this._kraken;
  }

  get manifest() {
    return this._manifest;
  }

  generate(options) {
    _.forEach(this.kraken.models, (def, name) => {
      let model = new Model(name, def);

      this.manifest.definitions = _.merge(this.manifest.definitions, model.definitions);
      this.manifest.paths = _.merge(this.manifest.paths, model.paths);
    });

    return this.manifest;
  }

  generateAndWrite(outputPath, options) {
    let output = this.generate();

    FS.writeFileSync(outputPath, YAML.stringify(output, 24, 2));
  }
}

Swagger.Model = Model;
