import * as auth from '@tidal-music/auth';
import {
  bootstrap,
  play,
  pause,
  load,
  seek,
  reset,
  getPlaybackState,
  getMediaProduct,
  setCredentialsProvider,
  events,
} from '@tidal-music/player';
import { api } from './apis/api';

// Define PlaybackState enum locally since it might not be exported
enum PlaybackState {
  IDLE = 'IDLE',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  STALLED = 'STALLED',
  NOT_PLAYING = 'NOT_PLAYING',
}

interface TidalPlayerConfig {
  clientId: string;
  clientSecret: string;
}

class TidalPlayerService {
  private isInitialized = false;
  private config: TidalPlayerConfig | null = null;
  private currentTrackId: string | null = null;
  private playbackStartTime: Date | null = null;

  // Initialize the TIDAL SDK with client credentials
  async initialize(config: TidalPlayerConfig) {
    if (this.isInitialized) {
      return;
    }

    this.config = config;

    try {
      // Initialize TIDAL Auth
      await auth.init({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        credentialsStorageKey: 'tidal-credentials',
        scopes: [
          'user.read',
          'playlists.read',
          'playlists.write',
          'collection.read',
          'search.read',
          'r_usr',
          'w_usr',
        ],
      });

      // Set credentials provider first
      setCredentialsProvider(auth.credentialsProvider);

      // Initialize Player using bootstrap function
      await bootstrap({
        outputDevices: true,
        players: [],
      });

      // Set up event listeners
      this.setupEventListeners();

      this.isInitialized = true;
      console.log('TIDAL Player initialized successfully');
    } catch (error) {
      console.error('Failed to initialize TIDAL Player:', error);
      throw error;
    }
  }

  // Event handler for player events
  private handlePlayerEvent(event: any) {
    console.log('TIDAL Player Event:', event);

    switch (event.type) {
      case 'playback-state-changed':
        this.handlePlaybackStateChanged(event.data);
        break;
      case 'media-product-transition':
        this.handleMediaProductTransition(event.data);
        break;
      default:
        console.log('Unhandled player event:', event);
    }
  }

  // Set up additional event listeners
  private setupEventListeners() {
    // Monitor playback state changes using events API
    events.addEventListener('playback-state-changed', (event: any) => {
      console.log('Playback state changed:', event.detail);
      const state = event.detail.playbackState;

      if (state === 'PLAYING' && this.currentTrackId) {
        this.playbackStartTime = new Date();
        this.recordPlaybackStart();
      } else if (state === 'PAUSED' || state === 'STALLED') {
        this.recordPlaybackEnd();
      }
    });

    // Monitor media product changes
    events.addEventListener('media-product-transition', (event: any) => {
      console.log('Media product changed:', event.detail);
      const mediaProduct = event.detail.mediaProduct;
      this.currentTrackId = mediaProduct?.id || null;
    });
  }

  // Play a track by ID
  async playTrack(trackId: string) {
    if (!this.isInitialized) {
      throw new Error('TIDAL Player not initialized');
    }

    try {
      // Validate track accessibility through our API
      const response = await api.play(trackId);
      if (!response.data.success) {
        throw new Error(response.data.message || 'Track not available');
      }

      // Load and play the track using functional API
      await load({
        productId: trackId,
        productType: 'track',
        sourceId: trackId,
        sourceType: 'track',
      });

      await play();

      this.currentTrackId = trackId;
      console.log(`Playing track: ${trackId}`);
    } catch (error) {
      console.error('Failed to play track:', error);
      throw error;
    }
  }

  // Pause playback
  async pausePlayback() {
    if (!this.isInitialized) return;

    await pause();
    this.recordPlaybackEnd();
  }

  // Resume playback
  async resume() {
    if (!this.isInitialized) return;

    await play();
    this.playbackStartTime = new Date();
  }

  // Skip to next track
  async skipToNext() {
    if (!this.isInitialized) return;

    this.recordPlaybackEnd();
    // Note: skipToNext would need to be imported if available in the new API
    console.log('Skip to next not implemented in current API');
  }

  // Seek to position
  async seekTo(position: number) {
    if (!this.isInitialized) return;

    await seek(position);
  }

  // Get current playback state
  getPlaybackState(): any {
    try {
      return getPlaybackState();
    } catch {
      return null;
    }
  }

  // Get current track
  getCurrentTrack() {
    try {
      return getMediaProduct() || { id: this.currentTrackId };
    } catch {
      return { id: this.currentTrackId };
    }
  }

  // Get current position (would need to be tracked from events)
  getCurrentPosition(): number {
    // This would need additional implementation based on available APIs
    return 0;
  }

  // Record playback start with our API
  private async recordPlaybackStart() {
    if (!this.currentTrackId) return;

    try {
      // Update current session
      await fetch('/api/tidal/session/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          trackId: this.currentTrackId,
          startedAt: this.playbackStartTime?.toISOString(),
        }),
      });

      console.log(`Started tracking playback for ${this.currentTrackId}`);
    } catch (error) {
      console.error('Failed to record playback start:', error);
    }
  }

  // Record playback end with our API
  private async recordPlaybackEnd() {
    if (!this.currentTrackId || !this.playbackStartTime) return;

    const endTime = new Date();
    const duration = endTime.getTime() - this.playbackStartTime.getTime();

    // Only record if played for more than 30 seconds
    if (duration < 30000) return;

    try {
      await fetch('/api/tidal/session/end', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          trackId: this.currentTrackId,
          playedAt: this.playbackStartTime.toISOString(),
          endedAt: endTime.toISOString(),
          duration: Math.floor(duration / 1000), // Convert to seconds
        }),
      });

      console.log(
        `Recorded playback for ${this.currentTrackId}, duration: ${duration}ms`,
      );
    } catch (error) {
      console.error('Failed to record playback end:', error);
    }

    this.playbackStartTime = null;
  }

  // Handle playback state changes
  private handlePlaybackStateChanged(state: any) {
    console.log('Playback state changed to:', state);

    // Emit custom events for the application to listen to
    window.dispatchEvent(
      new CustomEvent('tidalPlaybackStateChanged', {
        detail: { state, trackId: this.currentTrackId },
      }),
    );
  }

  // Handle media product transitions
  private handleMediaProductTransition(data: any) {
    console.log('Media product transition:', data);

    if (data.to) {
      this.currentTrackId = data.to.id;
      this.playbackStartTime = new Date();
      this.recordPlaybackStart();
    }

    if (data.from) {
      // Previous track ended
      this.recordPlaybackEnd();
    }

    // Emit custom event
    window.dispatchEvent(
      new CustomEvent('tidalTrackChanged', {
        detail: { from: data.from, to: data.to },
      }),
    );
  }

  // Clean up
  dispose() {
    if (this.isInitialized) {
      this.recordPlaybackEnd();
      reset(); // Reset the player state
      // Remove event listeners if needed
      // events.removeEventListener(...) would be called here
    }
    this.isInitialized = false;
    this.currentTrackId = null;
    this.playbackStartTime = null;
  }
}

// Export singleton instance
export const tidalPlayer = new TidalPlayerService();

// Export types for use in components
export { PlaybackState };
export type { TidalPlayerConfig };
