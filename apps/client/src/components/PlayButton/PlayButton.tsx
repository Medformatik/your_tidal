import { PlayArrow } from "@mui/icons-material";
import { IconButton } from "@mui/material";
import clsx from "clsx";
import { useCallback, useState } from "react";
import { playTrack } from "../../services/redux/modules/user/thunk";
import { useAppDispatch } from "../../services/redux/tools";
import { TidalImage } from "../../services/types";
import { tidalPlayer } from "../../services/tidalPlayer";
import IdealImage from "../IdealImage";
import s from "./index.module.css";

interface PlayButtonProps {
  id: string;
  covers: TidalImage[];
  className?: string;
}

export default function PlayButton({ id, covers, className }: PlayButtonProps) {
  const dispatch = useAppDispatch();
  const [isPlaying, setIsPlaying] = useState(false);

  const play = useCallback(async () => {
    try {
      setIsPlaying(true);
      
      // Try to use TIDAL Player first (for actual playback)
      try {
        await tidalPlayer.playTrack(id);
      } catch (tidalError) {
        console.warn('TIDAL Player not available, falling back to server-side:', tidalError);
        // Fallback to server-side validation (for statistics tracking)
        dispatch(playTrack(id));
      }
    } catch (error) {
      console.error('Failed to play track:', error);
    } finally {
      setIsPlaying(false);
    }
  }, [dispatch, id]);

  return (
    <div className={clsx(s.root, className)}>
      <IdealImage
        images={covers}
        size={48}
        className={clsx("play-image", s.image)}
      />
      <IconButton onClick={play} className="play-button" disabled={isPlaying}>
        <PlayArrow className={s.icon} />
      </IconButton>
    </div>
  );
}
