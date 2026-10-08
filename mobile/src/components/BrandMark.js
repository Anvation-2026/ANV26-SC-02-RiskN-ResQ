import React from 'react';
import { Animated, Image, View } from 'react-native';
import { brand } from '../assets';

// The RiskN ResQ mark: "rq" with a coral wave-arrow rising from risk (r) to rescue (q).
// Built from three aligned layers (tile, letters, wave) so each can be animated on its own:
//   tile      Animated value 0..1: the tile scales/fades in
//   letters   Animated value 0..1: the letters rise in
//   draw      Animated value 0..1: the wave-arrow is drawn from left to right (a clip that widens)
// Without animated values it renders the finished mark. Pure Image + transform/opacity, so it runs natively on phones.
const WAVE_START = 0.2; // the wave occupies roughly 22%..76% of the tile's width (its round cap starts just before)
const WAVE_END = 0.78;

export default function BrandMark({ size = 96, tile, letters, draw, style, showTile = true }) {
  const box = { width: size, height: size };
  const tileStyle = tile ? { opacity: tile, transform: [{ scale: tile.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] } : null;
  const letterStyle = letters ? { opacity: letters, transform: [{ translateY: letters.interpolate({ inputRange: [0, 1], outputRange: [size * 0.08, 0] }) }] } : null;
  const clipWidth = draw ? draw.interpolate({ inputRange: [0, 1], outputRange: [size * WAVE_START, size * WAVE_END] }) : size;
  return (
    <View style={[box, style]} accessibilityRole="image" accessibilityLabel="RiskN ResQ">
      {showTile ? <Animated.Image source={brand.tile} style={[box, { position: 'absolute' }, tileStyle]} /> : null}
      <Animated.Image source={brand.letters} style={[box, { position: 'absolute' }, letterStyle]} />
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, height: size, width: clipWidth, overflow: 'hidden', opacity: draw ? draw.interpolate({ inputRange: [0, 0.02, 1], outputRange: [0, 1, 1] }) : 1 }}>
        <Image source={brand.wave} style={box} />
      </Animated.View>
    </View>
  );
}
