import Swagger from './src/swagger';

var swagger = new Swagger('./test/fixtures/.kraken');
swagger.generateAndWrite('./swagger.yaml');