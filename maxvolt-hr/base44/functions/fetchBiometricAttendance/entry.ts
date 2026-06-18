import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// This function is deprecated. Biometric attendance is now handled via
// the push-based receiveBiometricAttendance webhook from the MX-One Sync agent.
Deno.serve(async (req) => {
  return Response.json({
    success: false,
    error: 'This sync method is deprecated. Biometric attendance is now pushed automatically by the MX-One Sync agent via the receiveBiometricAttendance webhook.'
  }, { status: 410 });
});