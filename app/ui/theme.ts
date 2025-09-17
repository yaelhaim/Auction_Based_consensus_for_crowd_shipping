// Design tokens shared across screens

export const COLORS = {
  bg: "#ffffff",
  text: "#0b0b0b",
  dim: "#6b7280",
  border: "#e5e7eb",
  card: "#ffffff",

  primary: "#9bac70",
  primaryDark: "#475530",
  mocha: "#8b5e3c",

  // תתי-גוונים רכים (לרקעים פסטליים בלי ורוד)
  softSage: "#F1F6EA", // ירקרק רך
  softMocha: "#F1E6DE", // בז' חמים מהחום
  softSlate: "#F6F7F9", // אפור עדין לניטרל
};

export const RAD = { xs: 8, sm: 12, md: 16, lg: 20, pill: 999 };
export const SHADOW = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};
