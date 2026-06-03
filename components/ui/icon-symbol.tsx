import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView, SymbolViewProps, SymbolWeight } from 'expo-symbols';
import { StyleProp, ViewStyle, Platform } from 'react-native';

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: string;
  size?: number;
  color: string;
  style?: StyleProp<ViewStyle>;
  weight?: SymbolWeight;
}) {
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        weight={weight}
        tintColor={color}
        resizeMode="scaleAspectFit"
        name={name as SymbolViewProps['name']}
        style={[{ width: size, height: size }, style]}
      />
    );
  }

  // Android fallback: map common SF Symbol names to MaterialIcons
  const iconMap: Record<string, keyof typeof MaterialIcons.glyphMap> = {
    'house.fill': 'home',
    'paperplane.fill': 'send',
    'chevron.left.forwardslash.chevron.right': 'code',
    'chevron.right': 'chevron-right',
    'chevron.left': 'chevron-left',
    'person.fill': 'person',
    'gearshape.fill': 'settings',
    'magnifyingglass': 'search',
    'plus': 'add',
    'xmark': 'close',
    'checkmark': 'check',
    'star.fill': 'star',
    'heart.fill': 'favorite',
    'bell.fill': 'notifications',
    'trash.fill': 'delete',
    'square.and.arrow.up': 'share',
    'doc.fill': 'description',
    'photo.fill': 'photo',
    'camera.fill': 'camera',
    'map.fill': 'map',
    'location.fill': 'location-on',
  };

  const materialName = iconMap[name] ?? 'circle';

  return (
    <MaterialIcons
      color={color}
      size={size}
      name={materialName}
      style={style as any}
    />
  );
}
