// SPIKE-01, S8: MapLibre draws Kartverket's topographic tiles. Outside the
// go/no-go. The style is written here, so no style, font or sprite is fetched
// from anyone; the only source is Kartverket. There is no user-location layer,
// and the screen is never opened during S1 to S7.
import { Camera, Map } from '@maplibre/maplibre-react-native';
import { useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';

import fixed from './fixed.json';

/** Galdhøpiggen, Norway's highest mountain: a public landmark where nobody lives. [lng, lat] */
const GALDHOPIGGEN = [8.3125, 61.6364];
/**
 * Map zoom levels. Each view lies inside Norway. The tiles are 256 px, and
 * MapLibre Native sizes its world at 512 px per tile, so it should fetch one
 * level deeper: 10, 14 and 18, where 18 is the deepest level of Kartverket's
 * webmercator set. That is reasoned from MapLibre's tile-cover rule, not yet
 * observed: S8's run is where it is checked.
 */
export const ZOOMS = [9, 13, 17];

const hex = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

const STYLE = {
  version: 8,
  sources: {
    kartverket: {
      type: 'raster',
      tiles: ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 18,
      attribution: '©Kartverket',
    },
  },
  layers: [
    // A colour Kartverket's map does not use: a map with no tiles is nearly all this.
    { id: 'sentinel', type: 'background', paint: { 'background-color': hex(fixed.sentinel) } },
    { id: 'topo', type: 'raster', source: 'kartverket' },
  ],
};

export function MapScreen({ onBack }) {
  const [zoom, setZoom] = useState(ZOOMS[0]);
  const [rendered, setRendered] = useState(null);
  const [failed, setFailed] = useState(false);
  const show = (next) => {
    setRendered(null);
    setFailed(false);
    setZoom(next);
  };
  let status = `loading zoom ${zoom}`;
  if (failed) status = `failed zoom ${zoom}`;
  else if (rendered === zoom) status = `rendered zoom ${zoom}`;
  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <Button testID="back" title="Journey" onPress={onBack} />
        {ZOOMS.map((level) => (
          <Button
            key={level}
            testID={`zoom-${level}`}
            title={`z${level}`}
            onPress={() => show(level)}
          />
        ))}
      </View>
      <Text testID="map-status">{status}</Text>
      <View testID="map" style={styles.map}>
        <Map
          key={zoom}
          style={styles.map}
          mapStyle={STYLE}
          logo={false}
          attribution={false}
          compass={false}
          scaleBar={false}
          onDidFinishRenderingMapFully={() => setRendered(zoom)}
          onDidFailLoadingMap={() => setFailed(true)}
        >
          <Camera initialViewState={{ center: GALDHOPIGGEN, zoom }} />
        </Map>
      </View>
      <Text testID="attribution" style={styles.attribution}>
        ©Kartverket
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },
  bar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  map: { flex: 1 },
  attribution: { padding: 8, textAlign: 'right' },
});
