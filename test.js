import Swagger from './src/swagger';

const swagger = new Swagger('./test/fixtures/.kraken');
swagger.generateAndWrite('./swagger.json', {
  examples: false,
  validators: false,
  apiGateway: true
});
