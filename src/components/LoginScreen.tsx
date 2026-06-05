import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Shield, Lock, ArrowRight, Activity, Globe, Loader2 } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (username: string, pass: string) => Promise<boolean>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    // Simulate network delay for institutional feel
    await new Promise(resolve => setTimeout(resolve, 800));

    const success = await onLogin(username, password);
    
    if (!success) {
      setError('AUTHENTICATION_FAILURE: INVALID_CREDENTIALS');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#E4E3E0] z-[9999] flex items-center justify-center overflow-hidden font-sans">
      {/* BACKGROUND DECORATION */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-navy rounded-full blur-[120px] -mr-[400px] -mt-[400px]"></div>
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-brand-red rounded-full blur-[100px] -ml-[300px] -mb-[300px]"></div>
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-10">
        <div className="h-full w-full bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] px-6 relative z-10"
      >
        <div className="mb-12 flex flex-col items-center">
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-8"
          >
            {/* OFFICIAL KAISO LOGO RECREATION */}
            <svg width="340" height="80" viewBox="0 0 340 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Logo Mark */}
              <rect x="0.5" y="0.5" width="69" height="69" rx="7.5" stroke="#1A3673" strokeWidth="3"/>
              <path d="M10 10H28V60H10V10Z" fill="#1A3673"/>
              <circle cx="45" cy="22" r="12" fill="#D62828"/>
              <path d="M32 40C32 51.0457 40.9543 60 52 60H60V48C60 43.5817 56.4183 40 52 40H32Z" fill="#67B1D9"/>
              
              {/* KAISO text */}
              <text x="85" y="52" fill="#1A3673" style={{ font: '900 56px sans-serif', letterSpacing: '0.05em' }}>KAISO</text>
              
              {/* Subtext */}
              <text x="85" y="72" fill="#67B1D9" style={{ font: '700 14px sans-serif', letterSpacing: '0.15em' }}>RESEARCH AND CONSULTING</text>
            </svg>
          </motion.div>
          
          <div className="h-[1px] w-12 bg-navy/20 mx-auto"></div>
        </div>

        <div className="bg-white p-8 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-navy/10">
            {isSubmitting && (
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                className="h-full bg-brand-red"
              />
            )}
          </div>

          <div className="flex items-center gap-3 mb-8 border-b border-slate-100 pb-4">
            <Lock size={16} className="text-brand-red" />
            <h2 className="text-xs font-black uppercase tracking-widest text-navy">Kaiso Intelligence Hub</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Username</label>
              <input 
                type="text" 
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-bold text-navy placeholder:text-slate-300 focus:bg-white focus:border-brand-red focus:outline-none transition-all"
                placeholder="Enter Access ID"
                required
              />
            </div>

            <div>
              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-12 bg-slate-50 border border-slate-200 rounded-xl px-4 text-sm font-bold text-navy placeholder:text-slate-300 focus:bg-white focus:border-brand-red focus:outline-none transition-all tracking-widest"
                placeholder="••••••••••••"
                required
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-brand-red/5 border border-brand-red/20 rounded-lg p-3"
                >
                  <p className="text-[10px] font-bold text-brand-red text-center tracking-tight capitalize">
                    {error}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full h-12 bg-navy text-white rounded-xl font-black uppercase tracking-widest text-[11px] shadow-lg shadow-navy/20 hover:bg-brand-red hover:shadow-brand-red/20 transition-all flex items-center justify-center gap-3 group"
            >
              {isSubmitting ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  Establish Connection
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>

        <div className="mt-12 flex flex-col items-center gap-6">
          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-1">
              <Globe size={18} className="text-navy/20" />
              <span className="text-[8px] font-black text-slate-400 tracking-widest">GLOBAL_NET</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Activity size={18} className="text-navy/20" />
              <span className="text-[8px] font-black text-slate-400 tracking-widest">SYSTEM_STABLE</span>
            </div>
          </div>
          
          <div className="text-center">
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">
              © 2026 KAISO STRATEGIC RESEARCH OPERATING SYSTEM
            </p>
            <p className="text-[7px] font-bold text-slate-300 uppercase tracking-widest">
              AUTHORIZED ACCESS ONLY // ASYMMETRIC ENCRYPTION ACTIVE
            </p>
          </div>
        </div>
      </motion.div>

      {/* SCAN LINE ANIMATION */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.05]">
        <div className="w-full h-px bg-brand-red absolute top-0 animate-scan-line shadow-[0_0_15px_rgba(214,40,40,0.8)]"></div>
      </div>
    </div>
  );
};
