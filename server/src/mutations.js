import mongoose from 'mongoose';
import { HttpError } from './http.js';
import { User } from './models.js';

mongoose.set('transactionAsyncLocalStorage', true);

const pending = new Map();
const topology = new WeakMap();

async function serialize(userId, work) {
  const key = String(userId);
  const previous = pending.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  pending.set(key, current);
  try {
    return await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}

export async function mutateWorkspace(userId, work) {
  const client = mongoose.connection.getClient();
  if (!topology.has(client)) {
    topology.set(client, mongoose.connection.db.admin().command({ hello: 1 })
      .then((hello) => Boolean(hello.setName || hello.msg === 'isdbgrid'))
      .catch((error) => {
        topology.delete(client);
        throw error;
      }));
  }
  if (await topology.get(client)) {
    return mongoose.connection.transaction(async () => {
      // Every workspace writer updates the same row, so deletions and inserts
      // conflict across function instances and MongoDB can retry the loser.
      const updated = await User.updateOne({ _id: userId }, { $inc: { workspaceRevision: 1 } }, { timestamps: false });
      if (!updated.matchedCount) throw new HttpError(401, 'Sign in to continue.');
      return work();
    });
  }
  return serialize(userId, async () => {
    if (!await User.exists({ _id: userId })) throw new HttpError(401, 'Sign in to continue.');
    return work();
  });
}
