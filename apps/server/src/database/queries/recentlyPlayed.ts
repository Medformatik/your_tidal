import { Types } from 'mongoose';
import { InfosModel } from '../Models';
import { logger } from '../../tools/logger';

interface PlaybackRecord {
  userId: string;
  trackId: string;
  playedAt: Date;
  source: string;
}

interface SessionRecord {
  userId: string;
  trackId: string;
  startedAt: Date;
  lastUpdated: Date;
}

// Store a track play record for recently played tracking
export async function storeTrackPlay(record: PlaybackRecord) {
  try {
    // Create an Infos record for the track play
    const infoRecord = new InfosModel({
      owner: new Types.ObjectId(record.userId),
      played_at: record.playedAt,
      id: record.trackId,
      durationMs: 0, // Will be updated when we get track info
      albumId: '', // Will be updated when we get track info
      primaryArtistId: '', // Will be updated when we get track info
      artists: [], // Will be updated when we get track info
      metadata: {
        source: record.source,
        recordedAt: new Date(),
      }
    });

    await infoRecord.save();
    logger.debug(`Stored track play record for user ${record.userId}, track ${record.trackId}`);
  } catch (error) {
    logger.error('Failed to store track play record:', error);
    throw error;
  }
}

// Get recently played tracks for a user
export async function getRecentlyPlayed(userId: string, limit: number = 50, offset: number = 0) {
  try {
    const userObjectId = new Types.ObjectId(userId);
    
    const recentTracks = await InfosModel.find({
      owner: userObjectId,
      'metadata.source': 'tidal'
    })
    .sort({ played_at: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

    return recentTracks.map((track: any) => ({
      trackId: track.id,
      playedAt: track.played_at,
      userId: track.owner.toString(),
      source: track.metadata?.source || 'tidal'
    }));
  } catch (error) {
    logger.error('Failed to get recently played tracks:', error);
    throw error;
  }
}

// Store current session for real-time tracking
let currentSessions: Map<string, SessionRecord> = new Map();

export async function updateCurrentSession(userId: string, trackId: string, startedAt: Date) {
  const sessionKey = userId;
  
  currentSessions.set(sessionKey, {
    userId,
    trackId,
    startedAt,
    lastUpdated: new Date()
  });
  
  logger.debug(`Updated current session for user ${userId}, track ${trackId}`);
}

export async function getCurrentSession(userId: string): Promise<SessionRecord | null> {
  const sessionKey = userId;
  const session = currentSessions.get(sessionKey);
  
  if (!session) {
    return null;
  }
  
  // Clean up old sessions (older than 1 hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (session.lastUpdated < oneHourAgo) {
    currentSessions.delete(sessionKey);
    return null;
  }
  
  return session;
}

// Clean up old sessions periodically
export function startSessionCleanup() {
  setInterval(() => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const toDelete: string[] = [];
    
    for (const [key, session] of currentSessions.entries()) {
      if (session.lastUpdated < oneHourAgo) {
        toDelete.push(key);
      }
    }
    
    toDelete.forEach(key => {
      currentSessions.delete(key);
      logger.debug(`Cleaned up old session for key ${key}`);
    });
  }, 15 * 60 * 1000); // Run every 15 minutes
}

// End current session and record the final play
export async function endCurrentSession(userId: string, endedAt?: Date) {
  const session = await getCurrentSession(userId);
  if (!session) {
    return;
  }
  
  // Record the full play if it lasted more than 30 seconds
  const playDuration = (endedAt || new Date()).getTime() - session.startedAt.getTime();
  if (playDuration > 30000) { // 30 seconds minimum
    await storeTrackPlay({
      userId: session.userId,
      trackId: session.trackId,
      playedAt: session.startedAt,
      source: 'tidal'
    });
  }
  
  // Remove from current sessions
  currentSessions.delete(userId);
  logger.debug(`Ended session for user ${userId}, duration: ${playDuration}ms`);
}