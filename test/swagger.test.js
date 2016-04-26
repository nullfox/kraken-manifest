/* global define, it, describe, context, expect, sinon */

import Path from 'path';
import YAML from 'yamljs';
import Swagger from '../src/swagger';

const kraken = YAML.load(Path.join(__dirname, './fixtures/.kraken'));

describe('Swagger', () => {
  context('when instanciated with a string path', () => {
    it('should load the file', () => {
      const swagger = new Swagger(Path.join(__dirname, './fixtures/.kraken'));

      expect(swagger.kraken).to.be.a('object');
      expect(swagger.kraken).to.have.property('title');
      expect(swagger.kraken.title).to.be.equal(kraken.title);
    });
  });

  context('when instanciated with an object', () => {
    it('should load the object', () => {
      const swagger = new Swagger(kraken);

      expect(swagger.kraken).to.be.a('object');
      expect(swagger.kraken).to.have.property('title');
      expect(swagger.kraken.title).to.be.equal(kraken.title);
    });
  });
});
