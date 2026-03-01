import { useState, useMemo, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, TextField, IconButton, Chip, Skeleton,
  Dialog, DialogTitle, DialogContent, DialogActions, Button, InputAdornment,
  ToggleButtonGroup, ToggleButton, useMediaQuery, useTheme, Divider, CircularProgress,
} from '@mui/material';
import {
  Search, Refresh, Close, TrendingUp, TrendingDown, LocalFireDepartment,
  StarOutlineRounded, StarRounded, ShowChart, SwapVert,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { psxAPI } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { formatCurrency, formatNumber, formatPercent, getPnLColor, calcBrokerFee } from '../../lib/formatters';

const BUY_COLOR = '#15803d';
const SELL_COLOR = '#b91c1c';

export default function SharesPage() {
  const user = useAuthStore((s) => s.user);
  const showSnackbar = useAppStore((s) => s.showSnackbar);
  const showConfirm = useAppStore((s) => s.showConfirm);
  const queryClient = useQueryClient();
  const isMobile = useMediaQuery('(max-width:768px)');
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [detailStock, setDetailStock] = useState(null);
  const [scraping, setScraping] = useState(false);

  /* ── Trade modal state ── */
  const [tradeMode, setTradeMode] = useState('buy');
  const [tradePrice, setTradePrice] = useState('');
  const [tradeQty, setTradeQty] = useState('');
  const [tradeInputMode, setTradeInputMode] = useState('shares'); // 'shares' | 'amount'
  const [tradeAmount, setTradeAmount] = useState('');
  const [tradeFee, setTradeFee] = useState('');
  const [feeEdited, setFeeEdited] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  /* ── Data queries ── */
  const { data: allStocksData, isLoading } = useQuery({
    queryKey: ['psx-stocks'],
    queryFn: () => psxAPI.getStocks(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: gainersData } = useQuery({
    queryKey: ['psx-gainers'],
    queryFn: () => psxAPI.getGainers(),
    staleTime: 5 * 60 * 1000,
    enabled: filter === 'gainers',
  });

  const { data: losersData } = useQuery({
    queryKey: ['psx-losers'],
    queryFn: () => psxAPI.getLosers(),
    staleTime: 5 * 60 * 1000,
    enabled: filter === 'losers',
  });

  const { data: activeData } = useQuery({
    queryKey: ['psx-active'],
    queryFn: () => psxAPI.getActive(),
    staleTime: 5 * 60 * 1000,
    enabled: filter === 'active',
  });

  const { data: favorites = [] } = useQuery({
    queryKey: ['favorite-stocks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('favorite_stocks').select('symbol').eq('user_id', user.id);
      if (error) throw error;
      return data.map((f) => f.symbol);
    },
    enabled: !!user,
  });

  const { data: freeCashData } = useQuery({
    queryKey: ['stock-free-cash', user?.id],
    queryFn: async () => {
      const { data: cats } = await supabase.from('categories').select('id').ilike('name', '%Investment - Stocks%');
      const catIds = (cats || []).map((c) => c.id);
      let deposited = 0;
      if (catIds.length > 0) {
        const { data: txns } = await supabase.from('income_expense_transactions')
          .select('amount').eq('user_id', user.id).eq('type', 'debit').in('category_id', catIds);
        deposited = (txns || []).reduce((s, t) => s + Number(t.amount), 0);
      }
      const { data: stTxns } = await supabase.from('stock_transactions')
        .select('price, quantity, type, fee').eq('user_id', user.id);
      let bought = 0, sold = 0, totalFees = 0;
      (stTxns || []).forEach((t) => {
        const amt = Number(t.price) * Number(t.quantity);
        const fee = Number(t.fee) || 0;
        totalFees += fee;
        if (t.type === 'buy') bought += amt;
        else sold += amt;
      });
      // freeCash = deposited - (bought + allFees) + sold
      return { deposited, bought, sold, totalFees, freeCash: deposited - bought - totalFees + sold };
    },
    enabled: !!user,
  });
  const freeCash = freeCashData?.freeCash ?? 0;

  const { data: myTransactions = [] } = useQuery({
    queryKey: ['stock-transactions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_transactions').select('*').eq('user_id', user.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  /* ── My holdings map ── */
  const holdingsMap = useMemo(() => {
    const map = {};
    myTransactions.forEach((t) => {
      const sym = t.symbol?.toUpperCase();
      if (!map[sym]) map[sym] = { shares: 0, totalCost: 0 };
      const fee = Number(t.fee) || 0;
      if (t.type === 'buy') { map[sym].shares += Number(t.quantity); map[sym].totalCost += Number(t.price) * Number(t.quantity) + fee; }
      else {
        const qty = Number(t.quantity);
        const costBasis = map[sym].shares > 0 ? (map[sym].totalCost / map[sym].shares) * qty : 0;
        map[sym].shares -= qty; map[sym].totalCost -= costBasis;
      }
    });
    return map;
  }, [myTransactions]);

  /* ── Stocks list based on filter ── */
  const displayStocks = useMemo(() => {
    let list = [];
    if (filter === 'gainers') list = gainersData?.data || [];
    else if (filter === 'losers') list = losersData?.data || [];
    else if (filter === 'active') list = activeData?.data || [];
    else if (filter === 'favorites') {
      const all = allStocksData?.data || [];
      list = all.filter((s) => favorites.includes(s.symbol?.toUpperCase()));
    } else list = allStocksData?.data || [];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.symbol?.toLowerCase().includes(q));
    }
    return list;
  }, [filter, allStocksData, gainersData, losersData, activeData, favorites, search]);

  /* ── Favorite toggle ── */
  const favMutation = useMutation({
    mutationFn: async (symbol) => {
      const sym = symbol.toUpperCase();
      const isFav = favorites.includes(sym);
      if (isFav) {
        await supabase.from('favorite_stocks').delete().eq('user_id', user.id).eq('symbol', sym);
      } else {
        await supabase.from('favorite_stocks').insert({ user_id: user.id, symbol: sym });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorite-stocks'] }),
  });

  /* ── Buy / Sell mutation ── */
  const tradeMutation = useMutation({
    mutationFn: async ({ symbol, companyName, type, price, quantity, fee }) => {
      const { error } = await supabase.from('stock_transactions').insert({
        user_id: user.id, symbol: symbol.toUpperCase(), company_name: companyName,
        type, price: parseFloat(price), quantity: parseFloat(quantity),
        fee: parseFloat(fee) || 0,
        date: new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['stock-free-cash'] });
      queryClient.invalidateQueries({ queryKey: ['home-st-txns'] });
      setConfirmOpen(false);
      setDetailStock(null);
      showSnackbar(`${tradeMode === 'buy' ? 'Bought' : 'Sold'} successfully`, 'success');
    },
    onError: (e) => showSnackbar(e.message, 'error'),
  });

  /* ── Scrape / Refresh ── */
  const handleScrape = async () => {
    setScraping(true);
    try {
      await psxAPI.scrape();
      queryClient.invalidateQueries({ queryKey: ['psx-stocks'] });
      queryClient.invalidateQueries({ queryKey: ['psx-gainers'] });
      queryClient.invalidateQueries({ queryKey: ['psx-losers'] });
      queryClient.invalidateQueries({ queryKey: ['psx-active'] });
      showSnackbar('Prices refreshed', 'success');
    } catch (e) {
      showSnackbar('Refresh failed', 'error');
    } finally {
      setScraping(false);
    }
  };

  /* ── Open stock detail ── */
  const openDetail = useCallback((stock) => {
    setDetailStock(stock);
    setTradeMode('buy');
    setTradePrice(String(stock.current || ''));
    setTradeQty('');
    setTradeAmount('');
    setTradeInputMode('shares');
    setTradeFee('');
    setFeeEdited(false);
  }, []);

  /* ── Computed trade values ── */
  const computedShares = tradeInputMode === 'amount' && tradePrice > 0
    ? Math.round((Number(tradeAmount) / Number(tradePrice)) * 100) / 100 : Number(tradeQty) || 0;
  const computedAmount = tradeInputMode === 'shares'
    ? (Number(tradeQty) || 0) * (Number(tradePrice) || 0)
    : Number(tradeAmount) || 0;

  /* Auto-calculate broker fee unless user has manually edited it */
  const autoFee = calcBrokerFee(Number(tradePrice) || 0, computedShares);
  const effectiveFee = feeEdited ? (Number(tradeFee) || 0) : autoFee;
  // Auto-sync display when not manually edited
  if (!feeEdited && tradeFee !== String(autoFee) && computedShares > 0) {
    // We'll set it in the render via useEffect-free pattern — store as derived
  }
  const totalWithFee = tradeMode === 'buy' ? computedAmount + effectiveFee : computedAmount - effectiveFee;

  const myHolding = detailStock ? (holdingsMap[detailStock.symbol?.toUpperCase()] || { shares: 0, totalCost: 0 }) : { shares: 0, totalCost: 0 };

  const canTrade = computedShares > 0 && Number(tradePrice) > 0 &&
    (tradeMode === 'buy' ? totalWithFee <= freeCash : computedShares <= myHolding.shares);

  const handleConfirmTrade = () => {
    if (!detailStock || !canTrade) return;
    tradeMutation.mutate({
      symbol: detailStock.symbol,
      companyName: detailStock.company_name || detailStock.name || detailStock.symbol,
      type: tradeMode,
      price: tradePrice,
      quantity: computedShares,
      fee: effectiveFee,
    });
  };

  const filterChips = [
    { key: 'all', label: 'All', icon: <ShowChart sx={{ fontSize: 14 }} /> },
    { key: 'gainers', label: 'Gainers', icon: <TrendingUp sx={{ fontSize: 14 }} /> },
    { key: 'losers', label: 'Losers', icon: <TrendingDown sx={{ fontSize: 14 }} /> },
    { key: 'active', label: 'Active', icon: <LocalFireDepartment sx={{ fontSize: 14 }} /> },
    { key: 'favorites', label: 'Favorites', icon: <StarRounded sx={{ fontSize: 14 }} /> },
  ];

  return (
    <Box sx={{ pb: isMobile ? 10 : 0 }}>
      {/* ── Header ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
          Shares
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {allStocksData?.last_scrape && (
            <Typography sx={{ fontSize: '0.55rem', color: 'text.secondary', fontFeatureSettings: '"tnum"', lineHeight: 1.2, textAlign: 'right' }}>
              Updated{' '}
              {(() => {
                const d = new Date(allStocksData.last_scrape);
                const now = new Date();
                const diffMs = now - d;
                const diffMin = Math.floor(diffMs / 60000);
                if (diffMin < 1) return 'just now';
                if (diffMin < 60) return `${diffMin}m ago`;
                const diffHr = Math.floor(diffMin / 60);
                if (diffHr < 24) return `${diffHr}h ago`;
                return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
              })()}
            </Typography>
          )}
          <IconButton onClick={handleScrape} disabled={scraping}
            sx={{
              border: 1, borderColor: 'divider', borderRadius: 2.5, width: 36, height: 36,
              animation: scraping ? 'spin 1s linear infinite' : 'none',
              '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
            }}>
            {scraping ? <CircularProgress size={16} sx={{ color: 'text.secondary' }} /> : <Refresh sx={{ fontSize: 18 }} />}
          </IconButton>
        </Box>
      </Box>

      {/* ── Search ── */}
      <TextField fullWidth size="small" placeholder="Search by symbol or company..."
        value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 1.5 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 18, color: 'text.secondary' }} /></InputAdornment> }}
      />

      {/* ── Filter Chips ── */}
      <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
        {filterChips.map((c) => (
          <Chip key={c.key} label={c.label} icon={c.icon} size="small"
            onClick={() => setFilter(c.key)}
            sx={{
              fontSize: '0.68rem', fontWeight: 600, height: 28,
              bgcolor: filter === c.key ? (isDark ? '#fff' : '#111') : 'transparent',
              color: filter === c.key ? (isDark ? '#000' : '#fff') : 'text.secondary',
              border: `1px solid ${filter === c.key ? 'transparent' : (isDark ? '#333' : '#ddd')}`,
              '& .MuiChip-icon': { color: filter === c.key ? (isDark ? '#000' : '#fff') : 'text.secondary' },
              '&:hover': { bgcolor: filter === c.key ? (isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)') : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') },
            }}
          />
        ))}
      </Box>

      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mb: 1 }}>
        {displayStocks.length} share{displayStocks.length !== 1 ? 's' : ''}
      </Typography>

      {/* ── Stock List ── */}
      {isLoading ? (
        Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="rounded" height={56} sx={{ mb: 0.75 }} />)
      ) : displayStocks.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>No shares found</Typography>
        </Card>
      ) : (
        displayStocks.map((stock, i) => {
          const sym = stock.symbol?.toUpperCase();
          const isFav = favorites.includes(sym);
          const change = stock.change || 0;
          const changePct = stock.change_pct || stock.changePct || 0;
          const color = getPnLColor(change);
          return (
            <motion.div key={sym || i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}>
              <Card sx={{ mb: 0.75, cursor: 'pointer', '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' } }}
                onClick={() => openDetail(stock)}>
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.2 }} noWrap>{sym}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>
                      {formatNumber(stock.current, 2)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color, fontFeatureSettings: '"tnum"' }}>
                      {change >= 0 ? '+' : ''}{formatNumber(change, 2)} ({changePct >= 0 ? '+' : ''}{Number(changePct).toFixed(2)}%)
                    </Typography>
                  </Box>
                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); favMutation.mutate(sym); }}
                    sx={{ color: isFav ? '#eab308' : 'text.secondary', ml: 0.25 }}>
                    {isFav ? <StarRounded sx={{ fontSize: 18 }} /> : <StarOutlineRounded sx={{ fontSize: 18 }} />}
                  </IconButton>
                </CardContent>
              </Card>
            </motion.div>
          );
        })
      )}

      {/* ─────── Stock Detail / Trade Dialog ─────── */}
      <Dialog open={Boolean(detailStock)} onClose={() => setDetailStock(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, fontSize: '0.9rem', pb: 1 }}>
          {detailStock?.symbol}
          <IconButton onClick={() => setDetailStock(null)} size="small"><Close sx={{ fontSize: 18 }} /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3 }}>
          {detailStock && (
            <>
              {/* Stock info */}
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 700 }}>{detailStock.symbol}</Typography>
                <Typography sx={{ fontSize: '0.72rem', color: getPnLColor(detailStock.change || 0), fontWeight: 600 }}>
                  {formatNumber(detailStock.current, 2)} ({detailStock.change >= 0 ? '+' : ''}{formatNumber(detailStock.change || 0, 2)})
                </Typography>
              </Box>

              {/* My info */}
              <Box sx={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2, p: 1.5, borderRadius: 2,
                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
              }}>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 500 }}>Free Cash</Typography>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, fontFeatureSettings: '"tnum"' }} className="currency">{formatCurrency(freeCash)}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.03em', fontWeight: 500 }}>My Shares</Typography>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{formatNumber(myHolding.shares, 2)}</Typography>
                </Box>
              </Box>

              <Divider sx={{ mb: 2 }} />

              {/* Buy / Sell toggle */}
              <ToggleButtonGroup exclusive fullWidth size="small" value={tradeMode} onChange={(_, v) => { if (v) setTradeMode(v); }}
                sx={{ mb: 2, '& .MuiToggleButton-root': { fontWeight: 700, fontSize: '0.75rem', py: 0.8, textTransform: 'none', border: '1px solid', borderColor: 'divider', '&.Mui-selected': { bgcolor: tradeMode === 'buy' ? BUY_COLOR : SELL_COLOR, color: '#fff', '&:hover': { bgcolor: tradeMode === 'buy' ? BUY_COLOR : SELL_COLOR } } } }}>
                <ToggleButton value="buy">Buy</ToggleButton>
                <ToggleButton value="sell">Sell</ToggleButton>
              </ToggleButtonGroup>

              {/* Price */}
              <TextField fullWidth size="small" label="Price per share" type="number"
                value={tradePrice} onChange={(e) => setTradePrice(e.target.value)} sx={{ mb: 1.5 }}
                InputProps={{ startAdornment: <InputAdornment position="start">Rs</InputAdornment> }} />

              {/* Input mode toggle */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Chip label="By Shares" size="small"
                  onClick={() => { setTradeInputMode('shares'); setTradeAmount(''); }}
                  sx={{
                    fontSize: '0.65rem', fontWeight: 600, height: 26,
                    bgcolor: tradeInputMode === 'shares' ? (isDark ? '#fff' : '#111') : 'transparent',
                    color: tradeInputMode === 'shares' ? (isDark ? '#000' : '#fff') : 'text.secondary',
                    border: `1px solid ${tradeInputMode === 'shares' ? 'transparent' : (isDark ? '#333' : '#ddd')}`,
                  }} />
                <Chip label="By Amount" size="small"
                  onClick={() => { setTradeInputMode('amount'); setTradeQty(''); }}
                  sx={{
                    fontSize: '0.65rem', fontWeight: 600, height: 26,
                    bgcolor: tradeInputMode === 'amount' ? (isDark ? '#fff' : '#111') : 'transparent',
                    color: tradeInputMode === 'amount' ? (isDark ? '#000' : '#fff') : 'text.secondary',
                    border: `1px solid ${tradeInputMode === 'amount' ? 'transparent' : (isDark ? '#333' : '#ddd')}`,
                  }} />
                <SwapVert sx={{ fontSize: 16, color: 'text.secondary', ml: 'auto' }} />
              </Box>

              {tradeInputMode === 'shares' ? (
                <TextField fullWidth size="small" label="Number of shares" type="number"
                  value={tradeQty} onChange={(e) => setTradeQty(e.target.value)} sx={{ mb: 1.5 }}
                  inputProps={{ step: '0.01' }}
                  InputProps={{ endAdornment: <InputAdornment position="end">shares</InputAdornment> }} />
              ) : (
                <TextField fullWidth size="small" label="Total amount" type="number"
                  value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)} sx={{ mb: 1.5 }}
                  InputProps={{ startAdornment: <InputAdornment position="start">Rs</InputAdornment> }} />
              )}

              {/* Live calculation */}
              <Box sx={{
                p: 1.5, borderRadius: 2, mb: 1,
                bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
                border: '1px solid', borderColor: 'divider',
              }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>Shares</Typography>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{formatNumber(computedShares, 2)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>Price</Typography>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>Rs {formatNumber(Number(tradePrice) || 0, 2)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>Subtotal</Typography>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>Rs {formatNumber(computedAmount, 2)}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>Broker Fee</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <TextField
                      size="small" type="number"
                      value={feeEdited ? tradeFee : String(autoFee)}
                      onChange={(e) => { setTradeFee(e.target.value); setFeeEdited(true); }}
                      sx={{
                        width: 90,
                        '& .MuiOutlinedInput-root': { height: 24, fontSize: '0.7rem', fontWeight: 700, fontFeatureSettings: '"tnum"' },
                        '& .MuiOutlinedInput-input': { px: 0.75, py: 0, textAlign: 'right' },
                      }}
                      InputProps={{ startAdornment: <InputAdornment position="start" sx={{ '& .MuiTypography-root': { fontSize: '0.65rem' } }}>Rs</InputAdornment> }}
                    />
                    {feeEdited && (
                      <Typography
                        onClick={() => { setFeeEdited(false); setTradeFee(''); }}
                        sx={{ fontSize: '0.55rem', color: 'primary.main', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}>
                        reset
                      </Typography>
                    )}
                  </Box>
                </Box>
                <Divider sx={{ my: 0.5 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700 }}>{tradeMode === 'buy' ? 'Total Cost' : 'Net Received'}</Typography>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: tradeMode === 'buy' ? BUY_COLOR : SELL_COLOR, fontFeatureSettings: '"tnum"' }}>
                    Rs {formatNumber(totalWithFee, 2)}
                  </Typography>
                </Box>
              </Box>

              {tradeMode === 'buy' && totalWithFee > freeCash && totalWithFee > 0 && (
                <Typography sx={{ fontSize: '0.62rem', color: '#b91c1c', mb: 1 }}>
                  Insufficient free cash (available: {formatCurrency(freeCash)})
                </Typography>
              )}
              {tradeMode === 'sell' && computedShares > myHolding.shares && computedShares > 0 && (
                <Typography sx={{ fontSize: '0.62rem', color: '#b91c1c', mb: 1 }}>
                  Insufficient shares (you hold: {formatNumber(myHolding.shares, 2)})
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setDetailStock(null)} color="inherit"
            sx={{ flex: 1, fontSize: '0.8rem', borderRadius: 2.5, py: 1.1, fontWeight: 600, bgcolor: isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5' }}>
            Cancel
          </Button>
          <Button disabled={!canTrade || tradeMutation.isPending}
            onClick={() => setConfirmOpen(true)}
            variant="contained"
            sx={{
              flex: 1, fontSize: '0.8rem', borderRadius: 2.5, py: 1.1, fontWeight: 600,
              bgcolor: tradeMode === 'buy' ? BUY_COLOR : SELL_COLOR,
              color: '#fff',
              '&:hover': { bgcolor: tradeMode === 'buy' ? '#166534' : '#991b1b' },
              '&.Mui-disabled': { bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },
            }}>
            {tradeMode === 'buy' ? 'Buy' : 'Sell'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ─────── Confirmation Dialog ─────── */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 4 } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: '0.95rem', textAlign: 'center', pb: 0.5 }}>
          Confirm {tradeMode === 'buy' ? 'Purchase' : 'Sale'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ textAlign: 'center', py: 1 }}>
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', letterSpacing: '0.04em', textTransform: 'uppercase', mb: 0.5 }}>
              {tradeMode === 'buy' ? 'Buying' : 'Selling'}
            </Typography>
            <Typography sx={{ fontSize: '1.3rem', fontWeight: 800, color: tradeMode === 'buy' ? BUY_COLOR : SELL_COLOR }}>
              {formatNumber(computedShares, 2)} shares
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary', mt: 0.25 }}>
              of {detailStock?.symbol} @ Rs {formatNumber(Number(tradePrice) || 0, 2)}
            </Typography>

            <Divider sx={{ my: 2 }} />

            {[
              ['Subtotal', `Rs ${formatNumber(computedAmount, 2)}`],
              ['Broker Fee', `${tradeMode === 'sell' ? '−' : '+'}Rs ${formatNumber(effectiveFee, 2)}`],
              [tradeMode === 'buy' ? 'Total Cost' : 'Net Received', `Rs ${formatNumber(totalWithFee, 2)}`],
              ['Price per Share', `Rs ${formatNumber(Number(tradePrice) || 0, 2)}`],
              ['Quantity', `${formatNumber(computedShares, 2)} shares`],
            ].map(([k, v]) => (
              <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{k}</Typography>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, fontFeatureSettings: '"tnum"' }}>{v}</Typography>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit"
            sx={{ flex: 1, fontSize: '0.8rem', borderRadius: 2.5, py: 1.1, fontWeight: 600, bgcolor: isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5' }}>
            Cancel
          </Button>
          <Button onClick={handleConfirmTrade} disabled={tradeMutation.isPending}
            variant="contained"
            sx={{
              flex: 1, fontSize: '0.8rem', borderRadius: 2.5, py: 1.1, fontWeight: 600,
              bgcolor: isDark ? '#fff' : '#111', color: isDark ? '#000' : '#fff',
              '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)' },
            }}>
            {tradeMutation.isPending ? <CircularProgress size={18} sx={{ color: isDark ? '#000' : '#fff' }} /> : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
