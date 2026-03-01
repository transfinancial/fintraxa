import { Suspense, lazy } from 'react';
import { Box, CircularProgress, useMediaQuery } from '@mui/material';
import SwipeablePages from '../../components/SwipeablePages';

const Dashboard = lazy(() => import('./Dashboard'));
const AddFund = lazy(() => import('./AddFund'));
const Analytics = lazy(() => import('./Analytics'));

const Loader = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh' }}>
    <CircularProgress size={22} sx={{ color: 'text.secondary' }} />
  </Box>
);

export default function MFSection() {
  const isMobile = useMediaQuery('(max-width:768px)');

  /* Desktop — show Dashboard only (sidebar handles sub-page nav) */
  if (!isMobile) {
    return (
      <Suspense fallback={<Loader />}>
        <Dashboard />
      </Suspense>
    );
  }

  /* Mobile — all pages in a swipeable carousel */
  const pages = [
    { label: 'Portfolio', component: <Suspense fallback={<Loader />}><Dashboard /></Suspense> },
    { label: 'Add Fund', component: <Suspense fallback={<Loader />}><AddFund /></Suspense> },
    { label: 'Analytics', component: <Suspense fallback={<Loader />}><Analytics /></Suspense> },
  ];

  return <SwipeablePages pages={pages} />;
}
