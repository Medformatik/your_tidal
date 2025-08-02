import http from 'http';
import { dbLoop } from '../tidal/looper';
import { app } from '../app';
import { logger } from '../tools/logger';
import { checkBlacklistConsistency, connect } from '../database';
import { get, getWithDefault } from '../tools/env';
import { fixRunningImportsAtStart } from '../database/queries/importer';

export function startServer() {
  const port = getWithDefault('PORT', 8080);
  app.set('port', port);

  const server = http.createServer(app);

  function onError(error: any) {
    if (error.syscall !== 'listen') {
      throw error;
    }

    const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

    // handle specific listen errors with friendly messages
    switch (error.code) {
      case 'EACCES':
        console.error(`${bind} requires elevated privileges`);
        process.exit(1);
      case 'EADDRINUSE':
        console.error(`${bind} is already in use`);
        process.exit(1);
      default:
        throw error;
    }
  }

  function onListening() {
    const addr = server.address();
    const bind =
      typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`;
    logger.debug(`Listening on ${bind}`);
  }

  connect()
    .then(async () => {
      server.listen(port);
      server.on('error', onError);
      server.on('listening', onListening);
      fixRunningImportsAtStart().catch(logger.error);
      checkBlacklistConsistency().catch(logger.error);
      
      // Start session cleanup for recently played tracking
      const { startSessionCleanup } = await import('../database/queries/recentlyPlayed');
      startSessionCleanup();
      
      const domain = get('CLIENT_ENDPOINT');
      dbLoop().catch(logger.error);
    })
    .catch(console.error);
}
