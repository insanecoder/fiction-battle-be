export interface DbConnection<T = unknown> {
  name: string;
  native: T;
}

export interface DbAdapter<T = unknown> {
  connect(connectionName: string): Promise<DbConnection<T>>;
  disconnect(connectionName: string): Promise<void>;
}