/* global define, it, describe, context, expect, sinon */

import Client from '../src/client';

describe('Client', () => {
  context('when instanciated', () => {
    it('should setup a ZMQ dealer socket', () => {
      const client = new Client();

      expect(client.socket.type).to.be.equal('dealer');
    });
  });
});
