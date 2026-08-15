import { useMemo } from 'react';
import { View, StyleSheet, Text, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../contexts/ThemeContext';

export interface GraphNode {
  id: string;
  label: string;
  isSelf: boolean;
  incomingVolume: number;
  outgoingVolume: number;
  txCount: number;
}

export interface GraphLink {
  source: string;
  target: string;
  direction: 'in' | 'out';
  amount: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface Position {
  x: number;
  y: number;
}

const WIDTH = 320;
const HEIGHT = 320;
const REPULSION = 3200;
const ATTRACTION = 0.06;

/**
 * ForceGraph (V1.3) : visualisation SVG légère du réseau de paiement
 * (utilisateur courant au centre, partenaires autour, arêtes entrantes/
 * sortantes colorées selon le flux). Layout simple à forces (répulsion +
 * attraction au centre) exécuté en mémoire ; interactif par zoom/pan tactile
 * non requis pour la V1.3 (cible : lecture immédiate des flux).
 */
export default function ForceGraph({ data, style }: { data: GraphData; style?: ViewStyle }) {
  const { palette } = useTheme();

  const layout = useMemo<Record<string, Position>>(() => {
    const nodes = data.nodes;
    const positions: Record<string, Position> = {};
    const angles: Record<string, number> = {};
    nodes.forEach((node, index) => {
      positions[node.id] = {
        x: WIDTH / 2 + Math.cos((index / nodes.length) * Math.PI * 2) * 90,
        y: HEIGHT / 2 + Math.sin((index / nodes.length) * Math.PI * 2) * 90,
      };
      angles[node.id] = (index / nodes.length) * Math.PI * 2;
    });

    for (let iter = 0; iter < 60; iter++) {
      for (const node of nodes) {
        let fx = 0;
        let fy = 0;
        for (const other of nodes) {
          if (other.id === node.id) continue;
          const dx = positions[node.id].x - positions[other.id].x;
          const dy = positions[node.id].y - positions[other.id].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const repulse = REPULSION / (dist * dist);
          fx += (dx / dist) * repulse;
          fy += (dy / dist) * repulse;
        }
        const dxCenter = WIDTH / 2 - positions[node.id].x;
        const dyCenter = HEIGHT / 2 - positions[node.id].y;
        fx += dxCenter * ATTRACTION;
        fy += dyCenter * ATTRACTION;
        positions[node.id].x += Math.max(-6, Math.min(6, fx));
        positions[node.id].y += Math.max(-6, Math.min(6, fy));
      }
    }

    const self = nodes.find((n) => n.isSelf);
    if (self) {
      positions[self.id] = { x: WIDTH / 2, y: HEIGHT / 2 };
      for (const node of nodes) {
        if (node.isSelf) continue;
        const angle = angles[node.id];
        positions[node.id] = {
          x: WIDTH / 2 + Math.cos(angle) * 100,
          y: HEIGHT / 2 + Math.sin(angle) * 100,
        };
      }
    }
    return positions;
  }, [data]);

  const self = data.nodes.find((n) => n.isSelf);
  const others = data.nodes.filter((n) => !n.isSelf);

  return (
    <View style={[styles.container, { backgroundColor: palette.surface }, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {data.links.map((link, index) => {
          const sourcePos = layout[link.source];
          const targetPos = layout[link.target];
          if (!sourcePos || !targetPos) return null;
          const outgoing = link.direction === 'out';
          return (
            <Line
              key={index}
              x1={sourcePos.x}
              y1={sourcePos.y}
              x2={targetPos.x}
              y2={targetPos.y}
              stroke={outgoing ? palette.primary : palette.accent}
              strokeWidth={Math.min(5, Math.max(1, Math.sqrt(link.amount) * 0.15))}
              strokeOpacity={0.7}
            />
          );
        })}
        {others.map((node) => {
          const pos = layout[node.id];
          if (!pos) return null;
          const size = 7 + Math.min(9, Math.sqrt(node.txCount) * 1.6);
          return (
            <Circle
              key={node.id}
              cx={pos.x}
              cy={pos.y}
              r={size}
              fill={palette.secondary}
              stroke={palette.primary}
              strokeWidth={1.5}
            />
          );
        })}
        {self && layout[self.id] && (
          <Circle
            cx={layout[self.id].x}
            cy={layout[self.id].y}
            r={16}
            fill={palette.primary}
            stroke={palette.accent}
            strokeWidth={2}
          />
        )}
        {others.map((node) => {
          const pos = layout[node.id];
          if (!pos) return null;
          return (
            <SvgText
              key={`label-${node.id}`}
              x={pos.x}
              y={pos.y - 16}
              fontSize={8}
              fill={palette.text}
              textAnchor="middle"
            >
              {node.label.length > 10 ? `${node.label.slice(0, 9)}…` : node.label}
            </SvgText>
          );
        })}
        {self && layout[self.id] && (
          <SvgText
            x={layout[self.id].x}
            y={layout[self.id].y - 24}
            fontSize={9}
            fontWeight="700"
            fill={palette.text}
            textAnchor="middle"
          >
            Vous
          </SvgText>
        )}
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: palette.primary }]} />
          <Text style={[styles.legendText, { color: palette.muted }]}>Flux sortant</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: palette.accent }]} />
          <Text style={[styles.legendText, { color: palette.muted }]}>Flux entrant</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    paddingBottom: 22,
  },
  legend: {
    position: 'absolute',
    bottom: 6,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11 },
});
