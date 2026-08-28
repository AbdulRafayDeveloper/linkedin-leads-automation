import mongoose from 'mongoose';

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectToMongoDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  if (!connectionPromise) {
    const timeoutMs = Number(process.env.MONGODB_TIMEOUT_MS) || 10000;
    connectionPromise = mongoose
      .connect(uri, {
        dbName: process.env.MONGODB_DATABASE || 'leads',
        maxPoolSize: 10,
        serverSelectionTimeoutMS: timeoutMs,
      })
      .then((conn) => {
        console.log('MongoDB connected');
        return conn;
      })
      .catch((error) => {
        connectionPromise = null;
        console.error('MongoDB connection failed:', error.message);
        throw error;
      });
  }

  return connectionPromise;
}

export async function disconnectFromMongoDB(): Promise<void> {
  connectionPromise = null;
  await mongoose.disconnect();
}
