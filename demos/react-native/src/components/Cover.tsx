// demos/react-native/src/components/Cover.tsx
/**
 * Album cover with placeholder fallback. Uses expo-image — RN's bundled
 * <Image> had intermittent load failures with HTTP/2 hosts on iOS sim.
 */
import { useState } from 'react'
import { StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native'
import { Image } from 'expo-image'
import { coverUrl, type CoverSize } from '@/lib/covers'

export function Cover(props: {
  cb: string | number
  size: CoverSize
  fallbackLabel?: string
  style?: StyleProp<ImageStyle>
}) {
  const [failed, setFailed] = useState(false)
  const dim = props.size
  if (failed || !props.cb) {
    return (
      <View style={[styles.placeholder, { width: dim, height: dim }, props.style as object]}>
        <Text style={styles.placeholderText}>
          {(props.fallbackLabel ?? '♪').slice(0, 1).toUpperCase()}
        </Text>
      </View>
    )
  }
  return (
    <Image
      source={coverUrl(props.cb, props.size)}
      onError={() => setFailed(true)}
      contentFit="cover"
      transition={120}
      style={[{ width: dim, height: dim, backgroundColor: '#111' }, props.style]}
    />
  )
}

const styles = StyleSheet.create({
  placeholder: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#555', fontSize: 18, fontFamily: 'Menlo' },
})
