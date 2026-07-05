import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MapPin, Camera, Clock, CheckCircle, LogOut, LogIn, Radar } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import { safeDate } from '@/lib/dateUtils';
import AttendanceCameraCapture from '@/components/attendance/AttendanceCameraCapture';

// Returns a Date object with its ms representing IST clock digits as if they were UTC.
// This matches the "Store IST, display IST" convention used throughout the app.
// e.g. 9:00 AM IST → Date with getTime() = 2026-06-26T09:00:00Z (not actual UTC 03:30)
const toISTTime = () => new Date(Date.now() + 5.5 * 60 * 60 * 1000);

export default function MarkAttendance() {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationDetails, setLocationDetails] = useState(null);
  const [locationAddress, setLocationAddress] = useState('');
  const [locationError, setLocationError] = useState('');
  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refining, setRefining] = useState(false);   // GPS accuracy refinement in progress
  const [remarks, setRemarks] = useState('');        // optional note saved with the punch

  // ── Geofence auto attendance ──
  const [autoMode, setAutoMode] = useState(() => localStorage.getItem('auto_attendance') === '1');
  const [officeFence, setOfficeFence] = useState(null);   // assigned AppLocation with lat/lng/radius
  const [fenceDistance, setFenceDistance] = useState(null); // metres from office centre
  const autoBusyRef = useRef(false);
  const fenceCountRef = useRef({ in: 0, out: 0 });

  const distMetres = (lat1, lng1, lat2, lng2) => {
    const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };

  useEffect(() => {
    loadData();
    getCurrentLocationWithDetails();

    // Update time every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      const empRecord = await base44.entities.Employee.filter({ user_id: currentUser.id });
      if (empRecord.length > 0) {
        setEmployee(empRecord[0]);

        if (empRecord[0].shift_id) {
          const shiftData = await base44.entities.Shift.filter({ id: empRecord[0].shift_id });
          setShift(shiftData[0]);
        } else {
          const defaultShift = await base44.entities.Shift.filter({ is_default: true });
          setShift(defaultShift[0]);
        }

        // Geofence: find the employee's assigned office (Work Location ↔ AppLocation.name)
        try {
          const locs = await base44.entities.AppLocation.list();
          const withFence = locs.filter(l => l.is_active !== false && l.latitude != null && l.longitude != null && l.geofence_radius > 0);
          const assigned = withFence.find(l => (l.name || '').toLowerCase() === (empRecord[0].work_location || '').toLowerCase());
          setOfficeFence(assigned || (withFence.length === 1 ? withFence[0] : null));
        } catch { /* no locations — auto mode unavailable */ }
      }

      const today = format(new Date(), 'yyyy-MM-dd');
      const attendance = await base44.entities.Attendance.filter({
        user_id: currentUser.id,
        date: today
      });

      if (attendance.length > 0) {
        setTodayAttendance(attendance[0]);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setLoading(false);
    }
  };

  const reverseGeocode = async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&namedetails=1`,
        { headers: { 'Accept-Language': 'en', 'User-Agent': 'MaxvoltHRMS/1.0' } }
      );
      const data = await res.json();
      // Build a human-readable address with landmark
      const a = data.address || {};
      const houseNo = a.house_number;
      const parts = [
        houseNo,
        a.road || a.pedestrian,
        a.neighbourhood || a.quarter,
        a.suburb,
        a.city || a.town || a.village || a.county,
        a.state,
      ].filter(Boolean);

      // Landmark with distance: Nominatim returns the matched object's own lat/lon —
      // distance from us to it gives "32 m from Koshik Builders & Supplier" style text
      const landmarkName = data.namedetails?.name || a.amenity || a.building || a.shop || a.tourism || a.leisure || a.office;
      let landmarkLine = '';
      if (landmarkName && data.lat && data.lon) {
        const R = 6371000, la1 = lat * Math.PI / 180, la2 = Number(data.lat) * Math.PI / 180;
        const dLa = la2 - la1, dLo = (Number(data.lon) - lng) * Math.PI / 180;
        const dM = Math.round(2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2)));
        landmarkLine = dM > 0 && dM < 2000 ? `${dM} m from ${landmarkName}` : landmarkName;
      }

      return {
        summary: parts.slice(0, 5).join(', ') || data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        landmark_line: landmarkLine,
        city: a.city || a.town || a.village || 'Unknown',
        locality: a.suburb || a.neighbourhood || a.road || 'Unknown',
        landmark: landmarkName || 'N/A',
        pincode: a.postcode || 'Unknown',
        fullAddress: data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      };
    } catch {
      return {
        summary: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        landmark_line: '',
        city: 'Unknown', locality: 'Unknown', landmark: 'N/A', pincode: 'Unknown',
        fullAddress: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      };
    }
  };

  // High-accuracy acquisition: watch fixes for up to 20s, keep the most accurate one,
  // stop early once we are within 15m. A refresh re-runs the refinement.
  const refineWatchRef = useRef(null);
  const getCurrentLocationWithDetails = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }
    if (refineWatchRef.current != null) { navigator.geolocation.clearWatch(refineWatchRef.current); refineWatchRef.current = null; }
    setRefining(true);
    let best = null;
    let geocodedFor = 0; // accuracy of the fix we last geocoded — re-geocode only on real improvement

    const finish = () => {
      if (refineWatchRef.current != null) { navigator.geolocation.clearWatch(refineWatchRef.current); refineWatchRef.current = null; }
      setRefining(false);
    };

    const useFix = async (position) => {
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      if (best && coords.accuracy >= best.accuracy) return; // only improvements
      best = coords;
      setLocation(coords);
      setLocationError('');
      // Re-geocode when accuracy improves by 25m+ (or first fix)
      if (!geocodedFor || geocodedFor - coords.accuracy > 25) {
        geocodedFor = coords.accuracy;
        const geo = await reverseGeocode(coords.latitude, coords.longitude);
        setLocationAddress(geo.summary);
        setLocationDetails({
          city: geo.city, locality: geo.locality, landmark: geo.landmark,
          landmark_line: geo.landmark_line, pincode: geo.pincode, fullAddress: geo.fullAddress,
        });
      }
      if (coords.accuracy <= 15) finish(); // excellent fix — stop refining
    };

    refineWatchRef.current = navigator.geolocation.watchPosition(
      useFix,
      (error) => {
        finish();
        console.error('Error getting location:', error);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationError('Please enable location access in your device Settings to mark attendance.');
          toast.error('Location access denied. Enable it in Settings to mark attendance.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setLocationError('Location unavailable. Move to an open area and try again.');
          toast.error('Location unavailable. Move to an open area and try again.');
        } else {
          setLocationError('Unable to get your location. Please try again.');
          toast.error('Unable to get your location. Please try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
    setTimeout(finish, 20000); // hard stop after 20s — keep the best fix we got
  };

  const handleCameraCapture = (photoBlob) => {
    setCapturedPhoto(photoBlob);
    setShowCamera(false);
  };

  const handleCheckIn = async () => {
    if (!location) {
      toast.error('Waiting for location...');
      return;
    }

    setIsCheckingOut(false);
    setShowCamera(true);
  };

  const handleCheckOut = async () => {
    if (!location) {
      toast.error('Waiting for location...');
      return;
    }

    setIsCheckingOut(true);
    setShowCamera(true);
  };

  useEffect(() => {
    if (capturedPhoto && !showCamera) {
      if (isCheckingOut) {
        processCheckOut();
      } else {
        processCheckIn();
      }
    }
  }, [capturedPhoto, showCamera]);

  const processCheckIn = async () => {
    const checkInTime = toISTTime();
    const today = checkInTime.toISOString().split('T')[0]; // IST date since checkInTime uses IST digits
    // Optimistic update — show result immediately
    setTodayAttendance({
      user_id: user.id,
      date: today,
      check_in_time: checkInTime.toISOString(),
      status: 'present',
      shift_id: shift?.id
    });
    setLoading(false);
    try {
      let selfieUrl = '';
      if (capturedPhoto) {
        try {
          const uploadResponse = await base44.integrations.Core.UploadFile({ file: capturedPhoto });
          selfieUrl = uploadResponse.file_url;
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error('Failed to upload selfie. Proceeding without photo.');
        }
      }

      const created = await base44.entities.Attendance.create({
        user_id: user.id,
        date: today,
        check_in_time: checkInTime.toISOString(),
        check_in_location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          city: locationDetails?.city,
          locality: locationDetails?.locality,
          landmark: locationDetails?.landmark,
          landmark_distance: locationDetails?.landmark_line,
          pincode: locationDetails?.pincode,
          address: locationDetails?.fullAddress,
          location_address: locationAddress,
        },
        check_in_selfie_url: selfieUrl,
        status: 'present',
        shift_id: shift?.id,
        ...(remarks.trim() ? { notes: remarks.trim().slice(0, 200) } : {}),
      });
      setRemarks('');
      // Patch optimistic state with the real id so checkout can update correctly
      if (created?.id) setTodayAttendance(prev => prev ? { ...prev, id: created.id } : prev);

      toast.success('Checked in successfully');
      setCapturedPhoto(null);
      loadData();
    } catch (error) {
      console.error('Check-in error:', error);
      setTodayAttendance(null); // revert optimistic
      toast.error('Failed to check in');
    }
  };

  // ── Geofence auto attendance: watch position while the app is open ──
  const toggleAutoMode = (on) => {
    setAutoMode(on);
    localStorage.setItem('auto_attendance', on ? '1' : '0');
    fenceCountRef.current = { in: 0, out: 0 };
    if (on) toast.success('Auto attendance ON — keep the app open; you will be checked in when you reach the office');
  };

  useEffect(() => {
    if (!autoMode || !officeFence || !navigator.geolocation) return;
    if (todayAttendance?.check_out_time) return; // day already closed
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const d = distMetres(pos.coords.latitude, pos.coords.longitude, Number(officeFence.latitude), Number(officeFence.longitude));
        setFenceDistance(Math.round(d));
        if (pos.coords.accuracy > 150) return; // ignore poor fixes
        const inside = d <= Number(officeFence.geofence_radius);
        const wellOutside = d > Number(officeFence.geofence_radius) + 100; // exit buffer against GPS wobble
        if (!todayAttendance && inside) {
          fenceCountRef.current.out = 0;
          if (++fenceCountRef.current.in >= 2 && !autoBusyRef.current) autoCheckIn(pos.coords);
        } else if (todayAttendance && !todayAttendance.check_out_time && wellOutside) {
          fenceCountRef.current.in = 0;
          if (++fenceCountRef.current.out >= 3 && !autoBusyRef.current) autoCheckOut(pos.coords);
        } else {
          fenceCountRef.current = { in: 0, out: 0 };
        }
      },
      () => { /* keep silent — manual flow still works */ },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [autoMode, officeFence, todayAttendance]);

  const autoCheckIn = async (coords) => {
    autoBusyRef.current = true;
    try {
      const checkInTime = toISTTime();
      const today = checkInTime.toISOString().split('T')[0];
      const geo = await reverseGeocode(coords.latitude, coords.longitude);
      const created = await base44.entities.Attendance.create({
        user_id: user.id, date: today,
        check_in_time: checkInTime.toISOString(),
        check_in_location: {
          latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
          city: geo.city, locality: geo.locality, landmark: geo.landmark, pincode: geo.pincode,
          address: geo.fullAddress, location_address: geo.summary,
        },
        status: 'present', shift_id: shift?.id,
        auto_geofence: true, geofence_location: officeFence.name,
      });
      setTodayAttendance({ id: created?.id, user_id: user.id, date: today, check_in_time: checkInTime.toISOString(), status: 'present', auto_geofence: true });
      toast.success(`Auto checked-in at ${officeFence.name} 📍`);
      loadData();
    } catch (e) {
      console.error('Auto check-in failed:', e);
    } finally {
      autoBusyRef.current = false;
      fenceCountRef.current = { in: 0, out: 0 };
    }
  };

  const autoCheckOut = async (coords) => {
    if (!todayAttendance?.check_in_time || !todayAttendance?.id) return;
    autoBusyRef.current = true;
    try {
      const checkOutTime = toISTTime();
      const workingHours = (checkOutTime - new Date(todayAttendance.check_in_time)) / 3600000;
      const geo = await reverseGeocode(coords.latitude, coords.longitude);
      await base44.entities.Attendance.update(todayAttendance.id, {
        check_out_time: checkOutTime.toISOString(),
        check_out_location: {
          latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
          city: geo.city, locality: geo.locality, landmark: geo.landmark, pincode: geo.pincode,
          address: geo.fullAddress, location_address: geo.summary,
        },
        working_hours: parseFloat(workingHours.toFixed(2)),
        status: workingHours < (shift?.working_hours || 8) ? 'half_day' : 'present',
        auto_geofence_checkout: true,
      });
      base44.functions.invoke('computeAttendanceStatus', { attendance_id: todayAttendance.id }).catch(() => {});
      toast.success(`Auto checked-out — you left ${officeFence.name} (${workingHours.toFixed(1)}h)`);
      loadData();
    } catch (e) {
      console.error('Auto check-out failed:', e);
    } finally {
      autoBusyRef.current = false;
      fenceCountRef.current = { in: 0, out: 0 };
    }
  };

  const processCheckOut = async () => {
    if (!todayAttendance?.check_in_time) {
      toast.error('Check-in time missing — please refresh and try again');
      return;
    }
    const checkOutTime = toISTTime();
    const checkInTime = new Date(todayAttendance.check_in_time); // IST-digit stored, same offset → diff is correct
    const diffMs = checkOutTime - checkInTime;
    const workingHours = diffMs / (1000 * 60 * 60);
    const expectedHours = shift?.working_hours || 8;
    const status = workingHours < expectedHours ? 'half_day' : 'present';

    // Optimistic update
    const previousAttendance = todayAttendance;
    setTodayAttendance(prev => ({
      ...prev,
      check_out_time: checkOutTime.toISOString(),
      working_hours: parseFloat(workingHours.toFixed(2)),
      status
    }));
    setLoading(false);

    try {
      let selfieUrl = '';
      if (capturedPhoto) {
        try {
          const uploadResponse = await base44.integrations.Core.UploadFile({ file: capturedPhoto });
          selfieUrl = uploadResponse.file_url;
        } catch (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error('Failed to upload selfie. Proceeding without photo.');
        }
      }

      await base44.entities.Attendance.update(todayAttendance.id, {
        check_out_time: checkOutTime.toISOString(),
        check_out_location: {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          city: locationDetails?.city,
          locality: locationDetails?.locality,
          landmark: locationDetails?.landmark,
          landmark_distance: locationDetails?.landmark_line,
          pincode: locationDetails?.pincode,
          address: locationDetails?.fullAddress,
          location_address: locationAddress,
        },
        check_out_selfie_url: selfieUrl,
        working_hours: parseFloat(workingHours.toFixed(2)),
        status,
        ...(remarks.trim() ? { checkout_notes: remarks.trim().slice(0, 200) } : {}),
      });
      setRemarks('');

      // Recompute status server-side (handles grace period, late, overtime properly)
      base44.functions.invoke('computeAttendanceStatus', { attendance_id: todayAttendance.id }).catch(() => {});

      toast.success(`Checked out successfully (${workingHours.toFixed(2)} hours)`);
      setCapturedPhoto(null);
      loadData();
    } catch (error) {
      console.error('Check-out error:', error);
      setTodayAttendance(previousAttendance); // revert optimistic
      toast.error('Failed to check out');
    }
  };

  if (loading && !user) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  const isCheckedIn = todayAttendance && todayAttendance.check_in_time && !todayAttendance.check_out_time;
  const isCheckedOut = todayAttendance && todayAttendance.check_out_time;
  const canCheckIn = !todayAttendance;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Mark Attendance</h1>
          <p className="text-gray-600 mt-1 text-sm md:text-base">Check in and check out for the day</p>
        </div>

        {/* Geofence auto attendance */}
        {officeFence && (
          <Card className={autoMode ? 'border-blue-300 bg-blue-50/50' : ''}>
            <CardContent className="py-3 px-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-full ${autoMode ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                  <Radar className={`w-5 h-5 ${autoMode ? 'animate-pulse' : ''}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800">Auto attendance — {officeFence.name}</p>
                  <p className="text-xs text-gray-500">
                    {autoMode
                      ? fenceDistance != null
                        ? fenceDistance <= officeFence.geofence_radius
                          ? `You are inside the office zone (${fenceDistance}m from centre)`
                          : `${fenceDistance}m from office — zone radius ${officeFence.geofence_radius}m`
                        : 'Watching your location… keep the app open'
                      : `Walk in to check in, walk out to check out (${officeFence.geofence_radius}m zone). Works while the app is open.`}
                  </p>
                </div>
              </div>
              <Switch checked={autoMode} onCheckedChange={toggleAutoMode} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">Today's Attendance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 md:space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Date</p>
                <p className="font-semibold text-base md:text-lg">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Current Time</p>
                <p className="font-semibold text-base md:text-lg">{format(currentTime, 'h:mm a')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 pt-2 border-t">
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Employee</p>
                <p className="font-semibold text-sm md:text-base">{user?.full_name}</p>
                <p className="text-xs text-gray-600">{employee?.employee_code}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Shift</p>
                <p className="font-semibold text-xs md:text-sm">{shift?.name || 'Default Shift'}</p>
                <p className="text-xs text-gray-600">
                  {shift?.start_time} - {shift?.end_time} ({shift?.working_hours || 8} hours)
                </p>
              </div>
            </div>

            {locationDetails && (
              <div className="border-t pt-4 md:pt-6">
                <div className={`rounded-xl p-4 ${location?.accuracy <= 25 ? 'bg-green-50' : location?.accuracy <= 60 ? 'bg-amber-50' : 'bg-red-50'}`}>
                  <div className="flex items-start gap-3">
                    <MapPin className={`w-5 h-5 mt-0.5 flex-shrink-0 ${location?.accuracy <= 25 ? 'text-green-700' : location?.accuracy <= 60 ? 'text-amber-600' : 'text-red-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-sm md:text-base text-gray-800">
                          Your Current Location Accuracy: {location ? `${Math.round(location.accuracy)}m` : '—'}
                          {refining && <span className="ml-2 text-xs font-normal text-gray-500 animate-pulse">refining…</span>}
                        </p>
                        <button
                          type="button"
                          onClick={getCurrentLocationWithDetails}
                          disabled={refining}
                          className="p-1.5 rounded-full hover:bg-white/70 text-gray-600 flex-shrink-0"
                          title="Refresh location"
                        >
                          <svg className={`w-4 h-4 ${refining ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-gray-600 break-words leading-relaxed">
                        {locationAddress}
                        {locationDetails.landmark_line ? <>. <span className="text-gray-700">{locationDetails.landmark_line}</span></> : null}
                        {locationDetails.pincode && locationDetails.pincode !== 'Unknown' ? `, Pin-${locationDetails.pincode} (India)` : ''}
                      </p>
                      {location && (
                        <p className="mt-2 text-sm text-gray-500 break-all">
                          Long, Lat: {location.longitude.toFixed(14)}, {location.latitude.toFixed(14)}
                        </p>
                      )}
                      {location?.accuracy > 60 && (
                        <p className="mt-1.5 text-xs text-red-600 font-medium">Poor GPS signal — move to an open area and tap refresh.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Remarks — saved with the punch */}
            {!isCheckedOut && (
              <div className="pt-1">
                <p className="text-sm text-gray-500 mb-1.5">Remarks</p>
                <textarea
                  value={remarks}
                  onChange={e => setRemarks(e.target.value.slice(0, 200))}
                  placeholder="Add Remarks"
                  rows={2}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                />
                <p className="text-xs text-blue-500 mt-0.5">{remarks.length}/200 characters</p>
              </div>
            )}

            {todayAttendance && (
              <div className="space-y-3 bg-gray-50 p-3 md:p-4 rounded-lg">
                {todayAttendance.check_in_time && (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <div className="flex items-center gap-3 flex-1">
                      <LogIn className="w-5 h-5 text-green-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-gray-600">Check In</p>
                        <p className="font-semibold text-sm md:text-base">
                          {safeDate(todayAttendance.check_in_time, 'h:mm a')}
                        </p>
                        </div>
                        </div>
                        {todayAttendance.check_in_selfie_url && (
                        <img 
                        src={todayAttendance.check_in_selfie_url} 
                        alt="Check-in selfie" 
                        className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border"
                        />
                        )}
                        </div>
                        )}
                        {!todayAttendance.check_out_time && todayAttendance.check_in_time && (
                        <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800">
                        <p>
                        <strong>Checked in at: {safeDate(todayAttendance.check_in_time, 'h:mm a')}</strong>
                        </p>
                        <p className="text-xs mt-1">Status: Working</p>
                        </div>
                        )}
                        {todayAttendance.check_out_time && (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                      <div className="flex items-center gap-3 flex-1">
                        <LogOut className="w-5 h-5 text-red-600 flex-shrink-0" />
                        <div>
                          <p className="text-sm text-gray-600">Check Out</p>
                          <p className="font-semibold text-sm md:text-base">
                            {safeDate(todayAttendance.check_out_time, 'h:mm a')}
                          </p>
                        </div>
                      </div>
                      {todayAttendance.check_out_selfie_url && (
                        <img 
                          src={todayAttendance.check_out_selfie_url} 
                          alt="Check-out selfie" 
                          className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Clock className="w-5 h-5 text-blue-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-gray-600">Working Hours</p>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm md:text-base">
                            {todayAttendance.working_hours?.toFixed(2)} hours
                          </p>
                          {todayAttendance.status === 'half_day' && (
                            <Badge className="bg-yellow-100 text-yellow-800 text-xs">Half Day</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {canCheckIn && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 md:p-4 mb-4">
                <p className="text-sm font-medium text-yellow-800">
                  You have not checked in today
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
              {canCheckIn && (
                <Button
                  onClick={handleCheckIn}
                  disabled={loading || !location}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  size="lg"
                >
                  <LogIn className="w-5 h-5 mr-2" />
                  Check In
                </Button>
              )}

              {isCheckedIn && (
                <Button
                  onClick={handleCheckOut}
                  disabled={loading || !location}
                  className="flex-1 bg-red-600 hover:bg-red-700"
                  size="lg"
                >
                  <LogOut className="w-5 h-5 mr-2" />
                  Check Out
                </Button>
              )}

              {isCheckedOut && (
                <div className="flex-1 flex items-center justify-center gap-2 text-green-600 p-3 bg-green-50 rounded-lg">
                  <CheckCircle className="w-5 h-5 md:w-6 md:h-6 flex-shrink-0" />
                  <span className="font-semibold text-sm md:text-base">Attendance Marked for Today</span>
                </div>
              )}
            </div>

            {!location && !locationError && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 md:p-4">
                <p className="text-xs md:text-sm text-yellow-800">
                  <strong>Note:</strong> Fetching your location for attendance verification...
                </p>
              </div>
            )}

            {locationError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 md:p-4">
                <p className="text-xs md:text-sm text-red-800 font-medium">{locationError}</p>
                <p className="text-xs text-red-600 mt-1">
                  On iPhone: Settings → Privacy & Security → Location Services → Safari / Chrome → While Using the App
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AttendanceCameraCapture 
        open={showCamera}
        onClose={() => setShowCamera(false)}
        onCapture={handleCameraCapture}
      />
    </div>
  );
}