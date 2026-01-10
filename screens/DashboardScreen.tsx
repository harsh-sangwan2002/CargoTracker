import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Alert,
    Modal,
    TextInput,
    Pressable,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import StyleSheet from '../utils/styleShim';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { getTrips, addTrip, TripFirestore, updateTrip, deleteTrip } from '../services/tripService';

export default function DashboardScreen() {
    const navigation = useNavigation<any>();
    const user = auth.currentUser;

    // Modal state - Step 1
    const [modalVisible, setModalVisible] = useState(false);
    const [vehicleNo, setVehicleNo] = useState('');
    const [lrNo, setLrNo] = useState('');
    const [driverName, setDriverName] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [itemType, setItemType] = useState('');
    const [quantity, setQuantity] = useState('');
    const [fuelFilled, setFuelFilled] = useState('');

    // Modal state - Step 2
    const [modal2Visible, setModal2Visible] = useState(false);
    const [departureTime, setDepartureTime] = useState<Date | null>(null);
    const [arrivalTime, setArrivalTime] = useState<Date | null>(null);
    const [fromPlant, setFromPlant] = useState('');
    const [toPlant, setToPlant] = useState('');

    // Date picker state
    const [showDeparturePicker, setShowDeparturePicker] = useState(false);
    const [showArrivalPicker, setShowArrivalPicker] = useState(false);

    const [tempDepartureDate, setTempDepartureDate] = useState(new Date());
    const [tempArrivalDate, setTempArrivalDate] = useState(new Date());

    // Trips state
    const [trips, setTrips] = useState<(TripFirestore & { id: string })[]>([]);
    const [loading, setLoading] = useState(true);

    // View/Edit Modal state
    const [viewModalVisible, setViewModalVisible] = useState(false);
    const [selectedTrip, setSelectedTrip] = useState<(TripFirestore & { id: string }) | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    // Edit form states
    const [editVehicleNo, setEditVehicleNo] = useState('');
    const [editLrNo, setEditLrNo] = useState('');
    const [editDriverName, setEditDriverName] = useState('');
    const [editCompanyName, setEditCompanyName] = useState('');
    const [editItemType, setEditItemType] = useState('');
    const [editQuantity, setEditQuantity] = useState('');
    const [editFuelFilled, setEditFuelFilled] = useState('');
    const [editDepartureTime, setEditDepartureTime] = useState<Date | null>(null);
    const [editArrivalTime, setEditArrivalTime] = useState<Date | null>(null);
    const [editFromPlant, setEditFromPlant] = useState('');
    const [editToPlant, setEditToPlant] = useState('');

    // Load trips from Firebase on mount
    useEffect(() => {
        loadTrips();
    }, []);

    const loadTrips = async () => {
        try {
            setLoading(true);
            const fetchedTrips = await getTrips();
            setTrips(fetchedTrips);
        } catch (error) {
            console.error('Error loading trips:', error);
            Alert.alert('Error', 'Failed to load trips');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        Alert.alert('Logout', 'Are you sure you want to log out?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Logout',
                style: 'destructive',
                onPress: async () => {
                    await signOut(auth);
                    navigation.replace('Login');
                },
            },
        ]);
    };

    const formatDateTime = (date: Date | null) => {
        if (!date) return 'Select date & time';

        const options: Intl.DateTimeFormatOptions = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        };

        return date.toLocaleString('en-US', options);
    };

    const formatTimeAgo = (date: Date) => {
        const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    };

    const handleDeparturePickerOpen = () => {
        setTempDepartureDate(departureTime || new Date());
        setShowDeparturePicker(true);
    };

    const handleArrivalPickerOpen = () => {
        setTempArrivalDate(arrivalTime || new Date());
        setShowArrivalPicker(true);
    };

    const onDepartureChange = (event: any, selectedDate?: Date) => {
        if (event.type === 'dismissed') {
            setShowDeparturePicker(false);
            return;
        }

        if (selectedDate) {
            setTempDepartureDate(selectedDate);
        }

        if (Platform.OS === 'android') {
            setDepartureTime(selectedDate || null);
            setShowDeparturePicker(false);
        }
    };

    const onArrivalChange = (event: any, selectedDate?: Date) => {
        if (event.type === 'dismissed') {
            setShowArrivalPicker(false);
            return;
        }

        if (selectedDate) {
            setTempArrivalDate(selectedDate);
        }

        if (Platform.OS === 'android') {
            setArrivalTime(selectedDate || null);
            setShowArrivalPicker(false);
        }
    };

    const handleStep1Next = () => {
        if (!vehicleNo || !lrNo || !driverName || !companyName || !itemType || !quantity) {
            Alert.alert('Error', 'Please fill all required fields');
            return;
        }

        setModalVisible(false);
        setModal2Visible(true);
    };

    const handleAddTrip = async () => {
        if (!departureTime || !fromPlant || !toPlant) {
            Alert.alert('Error', 'Please fill required fields (Departure Time, From Plant, To Plant)');
            return;
        }

        try {
            const tripData: Omit<TripFirestore, 'createdAt'> = {
                truck: vehicleNo.toUpperCase(),
                status: `${fromPlant} → ${toPlant}${arrivalTime ? ' (Delivered)' : ' (En route)'}`,
                time: 'Just now',
                bidNo: lrNo,                    // LR No goes here
                quantity: quantity,
                departureTime: departureTime!,   // Non-null assertion since we validated
                arrivalTime: arrivalTime,
                fuelFilled: fuelFilled || '0',
                userId: user?.uid,
                driverName: driverName,
                fromPlant: fromPlant,
                toPlant: toPlant,
                companyName: companyName,
                itemType: itemType,
            };

            await addTrip(tripData);

            Alert.alert('Success ✓', `Trip added for ${vehicleNo.toUpperCase()}`);

            // Reset all form fields
            resetForm();

            // Reload trips
            await loadTrips();

            setModal2Visible(false);
        } catch (error) {
            console.error('Error adding trip:', error);
            Alert.alert('Error', 'Failed to add trip. Please try again.');
        }
    };

    const handleTripPress = (trip: TripFirestore & { id: string }) => {
        setSelectedTrip(trip);
        setViewModalVisible(true);
        setIsEditing(false);
    };

    const handleEditPress = () => {
        if (selectedTrip) {
            setEditVehicleNo(selectedTrip.truck);
            setEditLrNo(selectedTrip.bidNo);
            setEditDriverName(selectedTrip.driverName);
            setEditCompanyName(selectedTrip.companyName);
            setEditItemType(selectedTrip.itemType);
            setEditQuantity(selectedTrip.quantity);
            setEditFuelFilled(selectedTrip.fuelFilled);
            setEditDepartureTime(selectedTrip.departureTime);
            setEditArrivalTime(selectedTrip.arrivalTime);
            setEditFromPlant(selectedTrip.fromPlant);
            setEditToPlant(selectedTrip.toPlant);
            setIsEditing(true);
        }
    };

    const handleSaveEdit = async () => {
        if (!selectedTrip || !editVehicleNo || !editLrNo || !editDriverName || !editCompanyName ||
            !editItemType || !editQuantity || !editDepartureTime || !editFromPlant || !editToPlant) {
            Alert.alert('Error', 'Please fill all required fields');
            return;
        }

        try {
            const updatedData: Partial<TripFirestore> = {
                truck: editVehicleNo.toUpperCase(),
                bidNo: editLrNo,
                driverName: editDriverName,
                companyName: editCompanyName,
                itemType: editItemType,
                quantity: editQuantity,
                fuelFilled: editFuelFilled || '0',
                departureTime: editDepartureTime,
                arrivalTime: editArrivalTime,
                fromPlant: editFromPlant,
                toPlant: editToPlant,
                status: `${editFromPlant} → ${editToPlant}${editArrivalTime ? ' (Delivered)' : ' (En route)'}`,
            };

            await updateTrip(selectedTrip.id, updatedData);

            Alert.alert('Success ✓', 'Trip updated successfully');
            setIsEditing(false);
            setViewModalVisible(false);
            await loadTrips();
        } catch (error) {
            console.error('Error updating trip:', error);
            Alert.alert('Error', 'Failed to update trip. Please try again.');
        }
    };

    const handleDeleteTrip = () => {
        if (!selectedTrip) return;

        Alert.alert(
            'Delete Trip',
            'Are you sure you want to delete this trip?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteTrip(selectedTrip.id);
                            Alert.alert('Success ✓', 'Trip deleted successfully');
                            setViewModalVisible(false);
                            await loadTrips();
                        } catch (error) {
                            console.error('Error deleting trip:', error);
                            Alert.alert('Error', 'Failed to delete trip. Please try again.');
                        }
                    },
                },
            ]
        );
    };

    const handleViewModalClose = () => {
        setViewModalVisible(false);
        setIsEditing(false);
        setSelectedTrip(null);
    };

    const resetForm = () => {
        setVehicleNo('');
        setLrNo('');
        setDriverName('');
        setCompanyName('');
        setItemType('');
        setQuantity('');
        setFuelFilled('');
        setDepartureTime(null);
        setArrivalTime(null);
        setFromPlant('');
        setToPlant('');
    };

    const handleModalClose = () => {
        setModalVisible(false);
        setModal2Visible(false);
        resetForm();
    };

    // Stats
    const stats = [
        { title: 'Total Trucks', value: '24', color: '#1d4ed8' },
        { title: 'Active Trips', value: trips.length.toString(), color: '#16a34a' },
        { title: 'Drivers Online', value: '15', color: '#ea580c' },
        { title: 'Pending Loads', value: '7', color: '#7c3aed' },
    ];

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Header */}
                <View style={styles.header}>
                    <View>
                        <Text style={styles.welcomeText}>Welcome back!</Text>
                        <Text style={styles.emailText}>{user?.email || 'User'}</Text>
                    </View>
                    <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
                        <Text style={styles.logoutText}>Logout</Text>
                    </TouchableOpacity>
                </View>

                {/* Stats Grid */}
                <View style={styles.statsGrid}>
                    {stats.map((stat, index) => (
                        <View key={index} style={styles.statCard}>
                            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                            <Text style={styles.statTitle}>{stat.title}</Text>
                        </View>
                    ))}
                </View>

                {/* Recent Trips */}
                <Text style={styles.sectionTitle}>Recent Trips</Text>
                <View style={styles.activityList}>
                    {loading ? (
                        <Text style={styles.emptyText}>Loading trips...</Text>
                    ) : trips.length === 0 ? (
                        <Text style={styles.emptyText}>No trips yet. Add one!</Text>
                    ) : (
                        trips.map((item) => (
                            <View key={item.id} style={styles.activityItem}>
                                <View style={styles.activityDot} />
                                <View style={styles.activityContent}>
                                    <View style={styles.tripHeader}>
                                        <Text style={styles.truckName}>
                                            {item.truck} {item.driverName ? `(${item.driverName.split(' ')[0]})` : ''}
                                        </Text>
                                        <Text style={styles.routeText}>
                                            {item.fromPlant || 'N/A'} → {item.toPlant || 'N/A'}
                                        </Text>
                                    </View>
                                    <Text style={styles.statusText}>
                                        {formatDateTime(item.departureTime)} → {item.arrivalTime ? formatDateTime(item.arrivalTime) : 'Ongoing'}
                                    </Text>
                                </View>
                            </View>
                        ))
                    )}
                </View>
            </ScrollView>

            {/* Floating Add Button */}
            <TouchableOpacity
                style={styles.fab}
                onPress={() => setModalVisible(true)}
            >
                <Text style={styles.fabText}>+</Text>
            </TouchableOpacity>

            {/* Step 1 Modal - Basic Info */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modalVisible}
                onRequestClose={handleModalClose}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Add New Trip - Step 1</Text>
                        <Text style={styles.modalSubtitle}>Basic Information</Text>

                        <TextInput
                            style={styles.modalInput}
                            placeholder="Vehicle Number *"
                            value={vehicleNo}
                            onChangeText={setVehicleNo}
                            autoCapitalize="characters"
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="LR No *"
                            value={lrNo}
                            onChangeText={setLrNo}
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Driver Name *"
                            value={driverName}
                            onChangeText={setDriverName}
                            autoCapitalize="words"
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Company Name *"
                            value={companyName}
                            onChangeText={setCompanyName}
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Item Type *"
                            value={itemType}
                            onChangeText={setItemType}
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Quantity (tons) *"
                            value={quantity}
                            onChangeText={setQuantity}
                            keyboardType="numeric"
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Fuel Filled (liters)"
                            value={fuelFilled}
                            onChangeText={setFuelFilled}
                            keyboardType="numeric"
                        />

                        <View style={styles.modalButtons}>
                            <Pressable
                                style={[styles.modalButton, styles.cancelButton]}
                                onPress={handleModalClose}
                            >
                                <Text style={styles.cancelText}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.modalButton, styles.saveButton]}
                                onPress={handleStep1Next}
                            >
                                <Text style={styles.saveText}>Next</Text>
                            </Pressable>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Step 2 Modal - Trip Details */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={modal2Visible}
                onRequestClose={handleModalClose}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Add New Trip - Step 2</Text>
                        <Text style={styles.modalSubtitle}>Trip Details</Text>

                        <TextInput
                            style={styles.modalInput}
                            placeholder="From Plant *"
                            value={fromPlant}
                            onChangeText={setFromPlant}
                        />
                        <TextInput
                            style={styles.modalInput}
                            placeholder="To Plant *"
                            value={toPlant}
                            onChangeText={setToPlant}
                        />

                        {/* Departure Date & Time */}
                        <TouchableOpacity
                            style={styles.dateButton}
                            onPress={handleDeparturePickerOpen}
                        >
                            <Text style={[styles.dateText, departureTime && styles.dateTextSelected]}>
                                {departureTime ? formatDateTime(departureTime) : 'Departure Date & Time *'}
                            </Text>
                        </TouchableOpacity>

                        {showDeparturePicker && (
                            <Modal
                                transparent={true}
                                animationType="slide"
                                visible={showDeparturePicker}
                                onRequestClose={() => setShowDeparturePicker(false)}
                            >
                                <View style={pickerModalStyles.overlay}>
                                    <View style={pickerModalStyles.container}>
                                        <DateTimePicker
                                            value={tempDepartureDate}
                                            mode="datetime"
                                            display="spinner"
                                            onChange={onDepartureChange}
                                        />
                                        {Platform.OS === 'ios' && (
                                            <TouchableOpacity
                                                style={pickerModalStyles.doneButton}
                                                onPress={() => {
                                                    setDepartureTime(tempDepartureDate);
                                                    setShowDeparturePicker(false);
                                                }}
                                            >
                                                <Text style={pickerModalStyles.doneText}>Done</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            </Modal>
                        )}

                        {/* Arrival Date & Time */}
                        <TouchableOpacity
                            style={styles.dateButton}
                            onPress={handleArrivalPickerOpen}
                        >
                            <Text style={[styles.dateText, arrivalTime && styles.dateTextSelected]}>
                                {arrivalTime ? formatDateTime(arrivalTime) : 'Arrival Date & Time (optional)'}
                            </Text>
                        </TouchableOpacity>

                        {showArrivalPicker && (
                            <Modal
                                transparent={true}
                                animationType="slide"
                                visible={showArrivalPicker}
                                onRequestClose={() => setShowArrivalPicker(false)}
                            >
                                <View style={pickerModalStyles.overlay}>
                                    <View style={pickerModalStyles.container}>
                                        <DateTimePicker
                                            value={tempArrivalDate}
                                            mode="datetime"
                                            display="spinner"
                                            onChange={onArrivalChange}
                                        />
                                        {Platform.OS === 'ios' && (
                                            <TouchableOpacity
                                                style={pickerModalStyles.doneButton}
                                                onPress={() => {
                                                    setArrivalTime(tempArrivalDate);
                                                    setShowArrivalPicker(false);
                                                }}
                                            >
                                                <Text style={pickerModalStyles.doneText}>Done</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                            </Modal>
                        )}

                        <View style={styles.modalButtons}>
                            <Pressable
                                style={[styles.modalButton, styles.cancelButton]}
                                onPress={() => {
                                    setModal2Visible(false);
                                    setModalVisible(true);
                                }}
                            >
                                <Text style={styles.cancelText}>Back</Text>
                            </Pressable>
                            <Pressable
                                style={[styles.modalButton, styles.saveButton]}
                                onPress={handleAddTrip}
                            >
                                <Text style={styles.saveText}>Save Trip</Text>
                            </Pressable>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

        </SafeAreaView>
    );
}

const pickerModalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    container: {
        backgroundColor: 'white',
        paddingTop: 16,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    doneButton: {
        paddingVertical: 16,
        alignItems: 'center',
        backgroundColor: '#f0f0f0',
        borderTopWidth: 1,
        borderTopColor: '#ddd',
    },
    doneText: {
        fontSize: 18,
        color: '#007AFF',
        fontWeight: '600',
    },
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f3f4f6',
    },
    scrollContent: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    welcomeText: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#111827',
    },
    emailText: {
        fontSize: 16,
        color: '#6b7280',
        marginTop: 4,
    },
    logoutButton: {
        backgroundColor: '#ef4444',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
    },
    logoutText: {
        color: '#fff',
        fontWeight: '600',
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 32,
    },
    statCard: {
        backgroundColor: '#fff',
        width: '48%',
        padding: 20,
        borderRadius: 12,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    statValue: {
        fontSize: 36,
        fontWeight: 'bold',
    },
    statTitle: {
        fontSize: 14,
        color: '#6b7280',
        marginTop: 8,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 16,
    },
    activityList: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    activityItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',  // Changed from 'center'
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    activityDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#1d4ed8',
        marginRight: 12,
    },
    tripHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    routeText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#1d4ed8',
        marginLeft: 8,
    },
    activityContent: {
        flex: 1,
    },
    truckName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
        flex: 1,
    },
    statusText: {
        fontSize: 13,
        color: '#6b7280',
        marginTop: 0,
    },
    timeText: {
        fontSize: 12,
        color: '#9ca3af',
    },
    fab: {
        position: 'absolute',
        right: 20,
        bottom: 30,
        backgroundColor: '#1d4ed8',
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    fabText: {
        color: '#fff',
        fontSize: 32,
        fontWeight: '300',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: '#fff',
        width: '90%',
        maxHeight: '80%',
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 8,
        textAlign: 'center',
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#6b7280',
        marginBottom: 20,
        textAlign: 'center',
    },
    modalInput: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 16,
        backgroundColor: '#f9fafb',
        marginBottom: 14,
    },
    modalButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 20,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
        marginHorizontal: 8,
    },
    cancelButton: {
        backgroundColor: '#e5e7eb',
    },
    saveButton: {
        backgroundColor: '#1d4ed8',
    },
    cancelText: {
        color: '#374151',
        fontWeight: '600',
    },
    saveText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    emptyText: {
        fontSize: 16,
        color: '#9ca3af',
        textAlign: 'center',
        padding: 20,
    },
    dateButton: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 14,
        backgroundColor: '#f9fafb',
        marginBottom: 14,
    },
    dateText: {
        fontSize: 16,
        color: '#9ca3af',
    },
    dateTextSelected: {
        color: '#111827',
        fontWeight: '500',
    },
    viewModalScrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 40,
    },
    viewModalContent: {
        backgroundColor: '#fff',
        width: '90%',
        maxHeight: '90%',
        borderRadius: 16,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    detailLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#374151',
        flex: 1,
    },
    detailValue: {
        fontSize: 15,
        color: '#111827',
        flex: 1,
        textAlign: 'right',
    },
    viewModalButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 20,
        marginBottom: 10,
    },
    editButtonStyle: {
        backgroundColor: '#1d4ed8',
    },
    editButtonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    deleteButtonStyle: {
        backgroundColor: '#ef4444',
    },
    deleteButtonText: {
        color: '#fff',
        fontWeight: 'bold',
    },
    closeButton: {
        width: '100%',
        backgroundColor: '#e5e7eb',
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
    },
});