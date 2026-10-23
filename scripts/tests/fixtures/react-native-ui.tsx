import type { ReactNode } from "react";

interface Props {
  children?: ReactNode;
  disabled?: boolean;
  visible?: boolean;
  onPress?: () => void;
  onRequestClose?: () => void;
  accessibilityLabel?: string;
}
export const View = ({ children }: Props) => <div>{children}</div>;
export const Text = ({ children }: Props) => <span>{children}</span>;
export const Pressable = ({ children, disabled, onPress }: Props) => (
  <button disabled={disabled} onClick={onPress}>
    {children}
  </button>
);
export const ActivityIndicator = ({ accessibilityLabel }: Props) => (
  <span role="progressbar" aria-label={accessibilityLabel} />
);
export const Modal = ({ children, visible, onRequestClose }: Props) => {
  if (!visible) return null;
  return (
    <div
      role="dialog"
      onKeyDown={(event) => {
        if (event.key === "Escape") onRequestClose?.();
      }}
    >
      {children}
    </div>
  );
};
export const StyleSheet = { create: <T,>(styles: T): T => styles };
