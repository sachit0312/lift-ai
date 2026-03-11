import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, fontWeight, borderRadius, layout } from '../theme';

// ─── RestTimerBar (self-contained countdown, avoids parent re-renders every second) ───

export const RestTimerBar = React.memo(function RestTimerBar({
  endTime,
  totalSeconds,
  exerciseName,
  onAdjust,
  onDismiss,
}: {
  endTime: number;
  totalSeconds: number;
  exerciseName: string;
  onAdjust: (delta: number) => void;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((endTime - Date.now()) / 1000))
  );

  useEffect(() => {
    const update = () => {
      setRemaining(Math.max(0, Math.round((endTime - Date.now()) / 1000)));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  return (
    <View style={styles.restBar}>
      <View style={styles.restBarHeader}>
        <Text style={styles.restBarLabel}>Rest — {exerciseName}</Text>
        <Text style={styles.restBarTime}>
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
        </Text>
      </View>
      <View style={styles.restBarInner}>
        <View
          style={[
            styles.restBarFill,
            { width: `${totalSeconds > 0 ? (remaining / totalSeconds) * 100 : 0}%` },
          ]}
        />
      </View>
      <View style={styles.restBarActions}>
        <TouchableOpacity style={styles.restAdjustBtn} onPress={() => onAdjust(-15)}>
          <Text style={styles.restAdjustText}>-15s</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.restAdjustBtn} onPress={() => onAdjust(15)}>
          <Text style={styles.restAdjustText}>+15s</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.restSkipBtn} onPress={onDismiss}>
          <Text style={styles.restSkipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── ElapsedTimer (self-contained, avoids parent re-renders) ───

export const ElapsedTimer = React.memo(function ElapsedTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState('00:00');
  useEffect(() => {
    const update = () => {
      const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (h > 0) {
        setElapsed(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      } else {
        setElapsed(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <Text style={styles.headerTimer}>{elapsed}</Text>;
});

const styles = StyleSheet.create({
  restBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  restBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  restBarLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  restBarTime: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  restBarInner: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceLight,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  restBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  restBarActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
  },
  restAdjustBtn: {
    backgroundColor: colors.surfaceLight,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  restAdjustText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  restSkipBtn: {
    backgroundColor: colors.primaryDim + '30',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: layout.buttonHeightSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  restSkipText: {
    color: colors.primaryLight,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  headerTimer: {
    color: colors.primary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
});
