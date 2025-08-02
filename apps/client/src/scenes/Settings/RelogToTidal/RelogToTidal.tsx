import { Button } from "@mui/material";
import TitleCard from "../../../components/TitleCard";
import { getTidalLogUrl } from "../../../services/tools";
import SettingLine from "../SettingLine";

export default function RelogToTidal() {
  return (
    <TitleCard title="Miscellaneous">
      <SettingLine
        left="Relog to TIDAL"
        right={
          <Button>
            <a href={getTidalLogUrl()}>Relog</a>
          </Button>
        }
      />
    </TitleCard>
  );
}
