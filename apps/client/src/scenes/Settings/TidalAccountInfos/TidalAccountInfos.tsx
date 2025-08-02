import TitleCard from "../../../components/TitleCard";
import { TidalMe } from "../../../services/types";
import SettingLine from "../SettingLine";

interface TidalAccountInfosProps {
  tidalAccount: TidalMe;
}

export default function TidalAccountInfos({
  tidalAccount,
}: TidalAccountInfosProps) {
  return (
    <TitleCard title="Linked TIDAL account">
      <SettingLine left="Id" right={tidalAccount.id} />
      <SettingLine left="Mail" right={tidalAccount.email} />
      <SettingLine left="Product type" right={tidalAccount.product} />
    </TitleCard>
  );
}
