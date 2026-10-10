import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

let client = null;
let mongoDb = null;
let enabled = false;

// In-memory cache for fast synchronous access
const stateMemoryCache = new Map();

export function isMongoEnabled() {
  return enabled;
}

export async function initMongo({ uri, dataDir, generateVapidKeys }) {
  if (!uri) {
    return { enabled: false };
  }

  try {
    console.log('Connecting to MongoDB Atlas...');
    client = new MongoClient(uri);
    await client.connect();
    mongoDb = client.db('opengym');
    enabled = true;
    console.log('✓ MongoDB Atlas connected successfully');

    const systemCol = mongoDb.collection('system');
    const statesCol = mongoDb.collection('states');

    // 1. Session secret
    let secretDoc = await systemCol.findOne({ _id: 'secret' });
    let secret = secretDoc?.value;
    if (!secret) {
      const localSecretPath = path.join(dataDir, 'secret');
      if (fs.existsSync(localSecretPath)) {
        secret = fs.readFileSync(localSecretPath, 'utf8').trim();
      } else {
        secret = crypto.randomBytes(32).toString('hex');
      }
      await systemCol.updateOne({ _id: 'secret' }, { $set: { value: secret } }, { upsert: true });
      console.log('✓ MongoDB: Session secret initialized');
    }

    // 2. VAPID push notification keys
    let vapidDoc = await systemCol.findOne({ _id: 'vapid' });
    let vapid = vapidDoc?.value;
    if (!vapid) {
      const localVapidPath = path.join(dataDir, 'vapid.json');
      if (fs.existsSync(localVapidPath)) {
        try { vapid = JSON.parse(fs.readFileSync(localVapidPath, 'utf8')); } catch { /* ignore */ }
      }
      if (!vapid && generateVapidKeys) {
        vapid = generateVapidKeys();
      }
      if (vapid) {
        await systemCol.updateOne({ _id: 'vapid' }, { $set: { value: vapid } }, { upsert: true });
        console.log('✓ MongoDB: VAPID keys initialized');
      }
    }

    // 3. User accounts & database metadata
    let dbDoc = await systemCol.findOne({ _id: 'db' });
    let dbData = dbDoc?.data;
    if (!dbData) {
      const localDbPath = path.join(dataDir, 'db.json');
      if (fs.existsSync(localDbPath)) {
        try { dbData = JSON.parse(fs.readFileSync(localDbPath, 'utf8')); } catch { /* ignore */ }
      }
      dbData = dbData || { users: [], creds: [], subs: [], invites: [], deviceLinks: [] };
      await systemCol.updateOne({ _id: 'db' }, { $set: { data: dbData } }, { upsert: true });
      console.log(`✓ MongoDB: Users metadata initialized (${dbData.users.length} user(s) migrated/created)`);
    }

    // 4. User states (workouts, routines, etc.)
    const existingStates = await statesCol.find({}).toArray();
    if (existingStates.length > 0) {
      for (const doc of existingStates) {
        stateMemoryCache.set(doc._id, doc.state);
      }
      console.log(`✓ MongoDB: Loaded ${existingStates.length} user state(s) from Atlas`);
    } else {
      // Check if local state files exist to migrate into MongoDB
      try {
        if (fs.existsSync(dataDir)) {
          const files = fs.readdirSync(dataDir);
          let migrated = 0;
          for (const file of files) {
            const m = /^state-(.+)\.json$/.exec(file);
            if (m) {
              const uid = m[1];
              try {
                const s = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
                stateMemoryCache.set(uid, s);
                await statesCol.updateOne({ _id: uid }, { $set: { state: s, updatedAt: new Date() } }, { upsert: true });
                migrated++;
              } catch { /* ignore */ }
            }
          }
          if (migrated > 0) {
            console.log(`✓ MongoDB: Migrated ${migrated} local workout state(s) to Atlas`);
          }
        }
      } catch (err) {
        console.error('MongoDB: State migration check failed:', err.message);
      }
    }

    return { enabled: true, secret, vapid, dbData };
  } catch (err) {
    console.error('MongoDB initialization failed, falling back to disk:', err.message);
    enabled = false;
    return { enabled: false };
  }
}

export function saveMongoDb(dbData) {
  if (!enabled || !mongoDb) return;
  mongoDb.collection('system').updateOne(
    { _id: 'db' },
    { $set: { data: dbData, updatedAt: new Date() } },
    { upsert: true }
  ).catch(err => console.error('MongoDB saveDb failed:', err.message));
}

export function getMongoState(uid) {
  if (!enabled) return null;
  return stateMemoryCache.get(uid) || null;
}

export async function saveMongoState(uid, state) {
  if (!enabled) return;
  stateMemoryCache.set(uid, state);
  if (!mongoDb) return;
  try {
    await mongoDb.collection('states').updateOne(
      { _id: uid },
      { $set: { state, updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.error(`MongoDB saveMongoState failed for ${uid}:`, err.message);
  }
}

export async function deleteMongoState(uid) {
  if (!enabled) return;
  stateMemoryCache.delete(uid);
  if (!mongoDb) return;
  try {
    await mongoDb.collection('states').deleteOne({ _id: uid });
  } catch (err) {
    console.error(`MongoDB deleteMongoState failed for ${uid}:`, err.message);
  }
}

export function logMongoAudit(event) {
  if (!enabled || !mongoDb) return;
  mongoDb.collection('audit').insertOne({
    ...event,
    createdAt: new Date()
  }).catch(err => console.error('MongoDB audit log failed:', err.message));
}
