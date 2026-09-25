import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

// Two steps: (1) enter email -> a 6-digit OTP is emailed; (2) enter the OTP
// and a new password. The server never reveals whether the email is
// registered, so step 2 is always shown after step 1.
export default function ForgotPassword() {
  const [step, setStep] = useState("email"); // email | otp | done
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError("");
    setLoading(true);
    try {
      await base44.auth.forgotPasswordOtp(email.trim());
      setStep("otp");
      setCooldown(60);
    } catch (err) {
      setError(err.message || "Could not send the code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = (e) => { e.preventDefault(); sendCode(); };

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) return setError("Password must be at least 6 characters");
    if (newPassword !== confirmPassword) return setError("Passwords do not match");
    setLoading(true);
    try {
      await base44.auth.resetPasswordWithOtp({ email: email.trim(), otp_code: otp.trim(), new_password: newPassword });
      setStep("done");
    } catch (err) {
      setError(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const subtitle = step === "email" ? "We'll email you a 6-digit code"
    : step === "otp" ? `Enter the code sent to ${email}`
    : "Your password has been changed";

  return (
    <AuthLayout
      icon={step === "done" ? CheckCircle2 : step === "otp" ? KeyRound : Mail}
      title="Reset password"
      subtitle={subtitle}
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />Back to log in
        </Link>
      }
    >
      {step === "email" && (
        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email address</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email" type="email" autoComplete="email" autoFocus
                placeholder="you@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} className="pl-10 h-12" required
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</> : "Send code"}
          </Button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleReset} className="space-y-4">
          <p className="text-xs text-muted-foreground">If an account exists for this email, a code is on its way. It expires in 10 minutes.</p>
          <div className="space-y-2">
            <Label htmlFor="otp">6-digit code</Label>
            <Input
              id="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
              placeholder="123456" value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="h-12 text-center tracking-[0.4em] text-lg" required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" type="password" autoComplete="new-password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} className="h-12" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input id="confirmPassword" type="password" autoComplete="new-password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)} className="h-12" required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading || otp.length !== 6}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting...</> : "Reset password"}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
              onClick={sendCode} disabled={loading || cooldown > 0}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
            <button type="button" className="text-muted-foreground hover:underline"
              onClick={() => { setStep("email"); setOtp(""); setError(""); }}>
              Change email
            </button>
          </div>
        </form>
      )}

      {step === "done" && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-foreground">You can now log in with your new password.</p>
          <Link to="/login">
            <Button className="w-full h-12 font-medium">Go to log in</Button>
          </Link>
        </div>
      )}
    </AuthLayout>
  );
}
