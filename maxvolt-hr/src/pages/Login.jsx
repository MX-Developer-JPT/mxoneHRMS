import React, { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, Loader2, Sun, Moon, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useTheme } from "next-themes";

export default function Login() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const { theme, setTheme } = useTheme();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      window.location.href = "/";
    } catch (err) {
      setError(err.message || "Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center bg-background px-5 relative overflow-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Background gradient blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute -top-32 -right-32 w-72 h-72 rounded-full bg-indigo-600/10 dark:bg-indigo-500/8 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-72 h-72 rounded-full bg-violet-600/10 dark:bg-violet-500/8 blur-3xl" />
      </div>

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="fixed top-4 right-4 p-2.5 rounded-xl border border-border bg-card/90 backdrop-blur-sm hover:bg-muted transition-colors press-scale shadow-sm"
        style={{ marginTop: 'env(safe-area-inset-top)' }}
        aria-label="Toggle theme"
      >
        {theme === "dark"
          ? <Sun  className="w-4 h-4 text-amber-500" />
          : <Moon className="w-4 h-4 text-indigo-500" />
        }
      </button>

      <div className="w-full max-w-sm relative z-10">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-block bg-white rounded-2xl px-6 py-3 shadow-sm mb-5">
            <img src="/maxvolt-logo.jpg?v=6" alt="MaxVolt Energy" className="h-14 w-auto object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground mt-1.5 text-sm font-medium">Sign in to Maxvolt One</p>
        </div>

        {/* Card */}
        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          {/* Error */}
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-semibold text-foreground">Email address</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@maxvolt.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-12 rounded-xl border-border bg-muted/40 focus:bg-card transition-colors text-base"
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-sm font-semibold text-foreground">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-primary font-semibold hover:underline underline-offset-2"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-11 h-12 rounded-xl border-border bg-muted/40 focus:bg-card transition-colors text-base"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/40 hover:opacity-95 active:scale-[0.98] transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed press-scale"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
              ) : (
                <>Sign in <ArrowRight className="w-4 h-4" /></>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-muted-foreground mt-6 font-medium">
          Don't have an account?{" "}
          <Link to="/register" className="text-primary font-semibold hover:underline underline-offset-2">
            Create one
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground/50 mt-4">
          <a href="/PrivacyPolicy" className="hover:underline underline-offset-2">Privacy Policy</a>
          {" · "}
          <a href="/TermsOfService" className="hover:underline underline-offset-2">Terms of Service</a>
        </p>

        <p className="text-center text-xs text-muted-foreground/50 mt-2">
          Maxvolt Energy Industries Limited
        </p>
      </div>
    </div>
  );
}
