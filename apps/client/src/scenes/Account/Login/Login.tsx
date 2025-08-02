import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Checkbox } from "@mui/material";
import clsx from "clsx";
import Text from "../../../components/Text";
import { selectUser } from "../../../services/redux/modules/user/selector";
import { getTidalLogUrl } from "../../../services/tools";
import s from "../index.module.css";
import { LocalStorage, REMEMBER_ME_KEY } from "../../../services/storage";
import { useNavigate } from "../../../services/hooks/useNavigate";

export default function Login() {
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const [rememberMe, setRememberMe] = useState(
    LocalStorage.get(REMEMBER_ME_KEY) === "true",
  );

  useEffect(() => {
    if (user) {
      navigate("/");
    } else if (LocalStorage.get(REMEMBER_ME_KEY) === "true") {
      window.location.href = getTidalLogUrl();
    }
  }, [navigate, user]);

  const handleRememberMeClick = useCallback(async () => {
    const newRememberMe = !rememberMe;
    setRememberMe(newRememberMe);
    if (newRememberMe) {
      LocalStorage.set(REMEMBER_ME_KEY, "true");
    } else {
      LocalStorage.delete(REMEMBER_ME_KEY);
    }
  }, [rememberMe]);

  return (
    <div className={s.root}>
      <Text element="h1" className={s.title}>
        Login
      </Text>
      <Text className={s.welcome}>
        To access your personal dashboard, please login with your account
      </Text>
      <div>
        <a className={s.link} href={getTidalLogUrl()}>
          Login
        </a>
      </div>
      <div>
        <button
          type="button"
          className={clsx("no-button", s.rememberMe)}
          onClick={handleRememberMeClick}>
          <Checkbox
            checked={rememberMe}
            disableRipple
            disableTouchRipple
            disableFocusRipple
            classes={{ root: s.check }}
          />
          <Text>Remember me</Text>
        </button>
      </div>
    </div>
  );
}
