import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Camera, Clock, CheckCircle, LogOut, LogIn } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { format } from 'date-fns';
import AttendanceCameraCapture from '@/components/attendance/AttendanceCameraCapture';

export default function MarkAttendance() {
  const [user, setUser] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [location, setLocation] = useState(null);
  const [locationDetails, setLocationDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [shift, setShift] = useState(null);
  const [showCamera, setShowCamera] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

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

  const getCurrentLocationWithDetails = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const coords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          };
          setLocation(coords);

          // Get location details using reverse geocoding
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.latitude}&lon=${coords.longitude}&zoom=18&addressdetails=1`
            );
            const data = await response.json();
            
            setLocationDetails({
              city: data.address?.city || data.address?.town || data.address?.village || 'Unknown',
              locality: data.address?.suburb || data.address?.neighbourhood || data.address?.road || 'Unknown',
              landmark: data.address?.building || data.address?.amenity || 'N/A',
              pincode: data.address?.postcode || 'Unknown',
              fullAddress: data.display_name || 'Address unavailable'
            });
          } catch (error) {
            console.error('Error fetching location details:', error);
            setLocationDetails({
              city: 'Unknown',
              locality: 'Unknown',
              landmark: 'N/A',
              pincode: 'Unknown',
              fullAddress: `${coords.latitude}, ${coords.longitude}`
            });
          }
        },
        (error) => {
          console.error('Error getting location:', error);
          toast.error('Unable to get your location. Please enable location services.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    }
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
    const checkInTime = new Date();
    const today = checkInTime.toISOString().split('T')[0];
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

      await base44.entities.Attendance.create({
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
          pincode: locationDetails?.pincode,
          address: locationDetails?.fullAddress
        },
        check_in_selfie_url: selfieUrl,
        status: 'present',
        shift_id: shift?.id
      });

      toast.success('Checked in successfully');
      setCapturedPhoto(null);
      loadData();
    } catch (error) {
      console.error('Check-in error:', error);
      setTodayAttendance(null); // revert optimistic
      toast.error('Failed to check in');
    }
  };

  const processCheckOut = async () => {
    const checkOutTime = new Date();
    const checkInTime = new Date(todayAttendance.check_in_time);
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
          pincode: locationDetails?.pincode,
          address: locationDetails?.fullAddress
        },
        check_out_selfie_url: selfieUrl,
        working_hours: parseFloat(workingHours.toFixed(2)),
        status
      });

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
                <div className="flex items-start gap-3 mb-3">
                  <MapPin className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm md:text-base">Your Location</p>
                    <div className="mt-2 space-y-1 text-xs md:text-sm text-gray-600">
                      <p><strong>City:</strong> {locationDetails.city}</p>
                      <p><strong>Area:</strong> {locationDetails.locality}</p>
                      <p><strong>Landmark:</strong> {locationDetails.landmark}</p>
                      <p><strong>Pin Code:</strong> {locationDetails.pincode}</p>
                      <p className="break-words"><strong>Address:</strong> {locationDetails.fullAddress}</p>
                      {location && (
                        <>
                          <p><strong>Coordinates:</strong> {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</p>
                          <p>
                            <strong>GPS Accuracy:</strong>{' '}
                            <span className={location.accuracy <= 20 ? 'text-green-600 font-semibold' : location.accuracy <= 50 ? 'text-yellow-600 font-semibold' : 'text-red-600 font-semibold'}>
                              ±{location.accuracy.toFixed(0)} meters
                            </span>
                            {location.accuracy <= 20 && ' (Excellent)'}
                            {location.accuracy > 20 && location.accuracy <= 50 && ' (Good)'}
                            {location.accuracy > 50 && ' (Poor - Move to open area)'}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
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
                          {format(new Date(todayAttendance.check_in_time), 'h:mm a')}
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
                        <strong>Checked in at: {format(new Date(todayAttendance.check_in_time), 'h:mm a')}</strong>
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
                            {format(new Date(todayAttendance.check_out_time), 'h:mm a')}
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

            {!location && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 md:p-4">
                <p className="text-xs md:text-sm text-yellow-800">
                  <strong>Note:</strong> Fetching your location for attendance verification...
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