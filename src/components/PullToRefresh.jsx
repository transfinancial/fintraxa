import { useState, useRef, useCallback, useEffect } from 'react';
import { Box, useTheme, useMediaQuery } from '@mui/material';
import { motion, useAnimation } from 'framer-motion';

const THRESHOLD = 80;
const MAX_PULL = 120;
const SPINNER_SIZE = 32;

/**
 * PullToRefresh — wraps children with a pull-down-to-reload gesture (mobile only).
 * Disables Chrome's native overscroll-refresh.
 *
 * @param {() => Promise<void>} onRefresh  — async callback invoked on release past threshold
 * @param {React.ReactNode} children
 */
export default function PullToRefresh({ onRefresh, children }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isMobile = useMediaQuery('(max-width:768px)');

  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const currentY = useRef(0);
  const containerRef = useRef(null);
  const spinnerControls = useAnimation();

  // Determine if at scroll top (allows pull)
  const isAtTop = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    // Walk up to find scrollable ancestor
    let node = el;
    while (node && node !== document.body) {
      if (node.scrollTop > 0) return false;
      node = node.parentNode;
    }
    return window.scrollY <= 0;
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (refreshing || !isAtTop()) return;
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
  }, [refreshing, isAtTop]);

  const handleTouchMove = useCallback((e) => {
    if (refreshing) return;
    currentY.current = e.touches[0].clientY;
    const delta = currentY.current - startY.current;

    if (delta > 10 && isAtTop()) {
      // Apply resistance curve
      const dist = Math.min(delta * 0.45, MAX_PULL);
      setPullDistance(dist);
      setPulling(true);
      // Prevent native scroll when pulling
      if (dist > 5) e.preventDefault();
    } else if (pulling && delta <= 0) {
      setPullDistance(0);
      setPulling(false);
    }
  }, [refreshing, pulling, isAtTop]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return;

    if (pullDistance >= THRESHOLD && onRefresh) {
      setRefreshing(true);
      setPullDistance(THRESHOLD * 0.6);
      spinnerControls.start({
        rotate: 360,
        transition: { repeat: Infinity, duration: 0.8, ease: 'linear' },
      });
      try {
        await onRefresh();
      } catch (e) { /* silent */ }
      spinnerControls.stop();
      setRefreshing(false);
    }

    setPulling(false);
    setPullDistance(0);
  }, [pulling, pullDistance, onRefresh, spinnerControls]);

  // Attach non-passive touchmove listener for preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isMobile) return;
    const opts = { passive: false };
    el.addEventListener('touchmove', handleTouchMove, opts);
    return () => el.removeEventListener('touchmove', handleTouchMove, opts);
  }, [handleTouchMove, isMobile]);

  if (!isMobile) return children;

  const progress = Math.min(pullDistance / THRESHOLD, 1);
  const spinnerOpacity = Math.max(0, (progress - 0.2) / 0.8);
  const spinnerScale = 0.4 + progress * 0.6;

  return (
    <Box
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      sx={{ position: 'relative', minHeight: '100%' }}
    >
      {/* Spinner indicator */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: pullDistance,
          overflow: 'hidden',
          pointerEvents: 'none',
          transition: pulling ? 'none' : 'height 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
      >
        <motion.div
          animate={spinnerControls}
          style={{
            width: SPINNER_SIZE,
            height: SPINNER_SIZE,
            opacity: spinnerOpacity,
            transform: `scale(${spinnerScale})`,
          }}
        >
          <svg
            width={SPINNER_SIZE}
            height={SPINNER_SIZE}
            viewBox="0 0 32 32"
            fill="none"
            style={{
              transform: `rotate(${pullDistance * 3}deg)`,
              transition: pulling ? 'none' : 'transform 0.3s ease',
            }}
          >
            <circle
              cx="16" cy="16" r="12"
              stroke={isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}
              strokeWidth="2.5"
              fill="none"
            />
            <path
              d={`M16 4 A12 12 0 0 1 ${16 + 12 * Math.sin(progress * Math.PI * 1.5)} ${16 - 12 * Math.cos(progress * Math.PI * 1.5)}`}
              stroke={isDark ? '#fff' : '#000'}
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </motion.div>
      </Box>

      {/* Content with pull-down translation */}
      <Box
        sx={{
          transform: `translateY(${pullDistance}px)`,
          transition: pulling ? 'none' : 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
