import { StyleSheet, View } from 'react-native';

/**
 * The browser has no CanvasKit loaded, so the flowing shader is not drawn
 * there. The ground colour is, which is still a usable Liquid theme.
 */
export function LiquidBackdrop({ base }: { tint: string; accent: string; base: string; dark: boolean }) {
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: base }]} />;
}
