import { YourTidalError } from "./error";

class DatabaseError extends YourTidalError {}

export class NoResult extends DatabaseError {
  constructor() {
    super("No result found");
  }
}
