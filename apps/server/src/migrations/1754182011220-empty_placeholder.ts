import { startMigration } from '../tools/migrations';

export async function up() {
  startMigration('Empty Placeholder Migration');
}

export async function down() {}
