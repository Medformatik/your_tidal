import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { load, MigrationSet, Callback as CallbackError } from 'migrate';
import { connect } from './database';
import { MigrationModel } from './database/Models';
import { logger } from './tools/logger';
import { Database } from './tools/database';

type Callback = (err: any, data: any) => void;
export class MongoDbStore {
  load = async (fn: Callback) => {
    await connect();
    const data = await MigrationModel.findOne({});
    if (!data) {
      logger.info(
        'Cannot read migrations from database. If this is the first time you run migrations, then this is normal.',
      );
      return fn(null, {});
    }
    return fn(null, data);
  };

  save = async (set: MigrationSet, fn: CallbackError) => {
    await MigrationModel.updateOne(
      {},
      {
        $set: {
          lastRun: set.lastRun,
        },
        $push: {
          migrations: { $each: set.migrations },
        },
      },
      { upsert: true },
    );
    return fn(null);
  };
}

export function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  // Check if migrations directory exists
  if (!existsSync(migrationsDir)) {
    logger.info('No migrations directory found.');
    Database.startup()
      .then(() => {
        logger.info('Database startup completed - no migrations to run');
        process.exit(0);
      })
      .catch(err => {
        logger.error(`Database startup error: ${err}`);
        process.exit(1);
      });
    return;
  }

  // Check if migrations directory is empty (contains only .gitkeep or similar files)
  const migrationFiles = readdirSync(migrationsDir).filter(
    file => file.endsWith('.js') || file.endsWith('.ts'),
  );

  if (migrationFiles.length === 0) {
    logger.info('No migration files found.');
    Database.startup()
      .then(() => {
        logger.info('Database startup completed - no migrations to run');
        process.exit(0);
      })
      .catch(err => {
        logger.error(`Database startup error: ${err}`);
        process.exit(1);
      });
    return;
  }

  load(
    {
      migrationsDirectory: migrationsDir,
      stateStore: new MongoDbStore(),
    },
    async (err: any, set: MigrationSet) => {
      await Database.startup();
      logger.info('Starting migrations');
      if (err) {
        logger.error(`Error ${err}`);
        process.exit(1);
      }
      set.up((seterr: any) => {
        if (seterr) {
          logger.error(`Error ${seterr}`);
          process.exit(1);
        }
        logger.info('Migrations successfully ran');
        process.exit(0);
      });
    },
  );
}

runMigrations();
