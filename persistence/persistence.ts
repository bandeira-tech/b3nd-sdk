type Signature = { pubkey: string; signature: string };

type PersistenceObject<T> = {
  uri: string;
  value: T;
};

type PersistenceWrite<T> = {
  obj: PersistenceObject<T>;
  sig: Signature;
};

type PersistenceRecord<T> = {
  ts: number;
  data: T;
};

type PersistenceValidationFn<T> = (
  write: PersistenceWrite<T>,
) => Promise<boolean>;

type PersistenceConstructorArgs<T> = {
  schema: Record<string, PersistenceValidationFn<T>>;
};

// storage[protocol][toplevel][path] = record<value>
type PersistenceStorage<T> = Record<
  string,
  Record<string, Record<string, PersistenceRecord<T>>>
>;

export class Persistence<T> {
  schema: Record<string, PersistenceValidationFn<T>> = {};
  storage: PersistenceStorage<T> = {};

  constructor(args: PersistenceConstructorArgs<T>) {
    this.schema = args.schema;
    this.storage = Object.keys(this.schema)
      .map((k) => new URL(k))
      .reduce<PersistenceStorage<T>>(
        (data, url) => ({
          ...data,
          [url.protocol]: {
            ...(data[url.protocol] || {}),
            [url.hostname]: {},
          },
        }),
        {},
      );
  }

  async write(
    write: PersistenceWrite<T>,
  ): Promise<[error: boolean, record: PersistenceRecord<T> | null]> {
    const target = new URL(write.obj.uri);
    const auth =
      await this.schema[target.protocol + "//" + target.hostname](write);
    if (!auth) {
      return Promise.resolve([true, null]);
    }
    const record = {
      ts: Date.now(),
      data: write.obj.value,
    };
    this.storage[target.protocol][target.host][target.pathname] = record;
    return Promise.resolve([false, record]);
  }

  read(uri: string): Promise<PersistenceRecord<T>> {
    const target = new URL(uri);
    return Promise.resolve(
      this.storage[target.protocol][target.host][target.pathname],
    );
  }
}
