import * as Haptics from 'expo-haptics';
import { Pressable, type PressableProps } from 'react-native';

export function HapticTab({ onPress, ...rest }: PressableProps) {
  return (
    <Pressable
      onPress={(e) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      {...rest}
    />
  );
}
