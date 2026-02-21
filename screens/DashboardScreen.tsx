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
import { Picker } from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth } from '../firebaseConfig';
import { signOut } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { getTrips, addTrip, TripFirestore, updateTrip, deleteTrip } from '../services/tripService';
import { isManager, isAdmin } from '../services/userService';

export default function DashboardScreen() {
    const navigation = useNavigation<any>();
    const user = auth.currentUser;

    // Add trip modal
    const [addModalVisible, setAddModalVisible] = useState(false);
    const [isUserManager, setIsUserManager] = useState(false);
    const [isUserAdmin, setIsUserAdmin] = useState(false);
    const [checkingRole, setCheckingRole] = useState(true);

    // Add trip form states
    const [vehicleNo, setVehicleNo] = useState('');
    const [lrNo, setLrNo] = useState('');
    const [driverName, setDriverName] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [itemType, setItemType] = useState('');
    const [quantity, setQuantity] = useState('');
    const [fuelFilled, setFuelFilled] = useState('');
    const [fromPlant, setFromPlant] = useState('');
    const [toPlant, setToPlant] = useState('');
    const [departureTime, setDepartureTime] = useState<Date | null>(null);
    const [arrivalTime, setArrivalTime] = useState<Date | null>(null);

    // Date picker states
    const [showDeparturePicker, setShowDeparturePicker] = useState(false);
    const [showArrivalPicker, setShowArrivalPicker] = useState(false);
    const [tempDepartureDate, setTempDepartureDate] = useState(new Date());
    const [tempArrivalDate, setTempArrivalDate] = useState(new Date());

    // Trips list
    const [trips, setTrips] = useState<(TripFirestore & { id: string })[]>([]);
    const [loading, setLoading] = useState(true);

    // View/Edit modal
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
    const [editFromPlant, setEditFromPlant] = useState('');
    const [editToPlant, setEditToPlant] = useState('');
    const [editDepartureTime, setEditDepartureTime] = useState<Date | null>(null);
    const [editArrivalTime, setEditArrivalTime] = useState<Date | null>(null);

    // Put this near the top of the component, after other useState declarations
    const predefinedPlants = [
        'PTA terminal IOCL',
        'IVL Dhunseri',
        'Uflex Pvt limited',
        'Sanathan Textiles Mandi',
        'Aegios Poly films',
        'Polymer Terminal IOCL',
        'Meg Terminal IOCL',
        'BR Specialist',
    ];

    // Add these new states for controlling custom input visibility
    const [showCustomFromAdd, setShowCustomFromAdd] = useState(false);
    const [showCustomToAdd, setShowCustomToAdd] = useState(false);

    const [showCustomFromEdit, setShowCustomFromEdit] = useState(false);
    const [showCustomToEdit, setShowCustomToEdit] = useState(false);

    // For Add modal
    const [fromSuggestions, setFromSuggestions] = useState<string[]>([]);
    const [toSuggestions, setToSuggestions] = useState<string[]>([]);

    // For Edit modal
    const [editFromSuggestions, setEditFromSuggestions] = useState<string[]>([]);
    const [editToSuggestions, setEditToSuggestions] = useState<string[]>([]);

    const getSuggestions = (text: string) => {
        if (!text.trim()) return [];
        const lowerText = text.toLowerCase();
        return predefinedPlants.filter(plant =>
            plant.toLowerCase().includes(lowerText)
        );
    };

    useEffect(() => {
        loadTrips();
        checkUserRole();
    }, []);

    const checkUserRole = async () => {
        try {
            if (user?.uid) {
                const manager = await isManager(user.uid);
                const admin = await isAdmin(user.uid);
                console.log('🔍 Role Check:', { manager, admin, uid: user.uid, email: user.email });
                console.log('👁️ isUserManager will be:', manager || admin);
                setIsUserManager(manager || admin); // Both managers and admins get access
                setIsUserAdmin(admin);
            } else {
                console.log('⚠️ No user UID found');
            }
        } catch (error) {
            console.error('❌ Error checking user role:', error);
        } finally {
            setCheckingRole(false);
        }
    };

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
        if (!date) return 'Not selected';
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
        });
    };

    const resetAddForm = () => {
        setVehicleNo('');
        setLrNo('');
        setDriverName('');
        setCompanyName('');
        setItemType('');
        setQuantity('');
        setFuelFilled('');
        setFromPlant('');
        setToPlant('');
        setDepartureTime(null);
        setArrivalTime(null);
    };

    const handleAddTrip = async () => {
        if (
            !vehicleNo.trim() ||
            !lrNo.trim() ||
            !driverName.trim() ||
            !companyName.trim() ||
            !itemType.trim() ||
            !quantity.trim() ||
            !fromPlant.trim() ||
            !toPlant.trim() ||
            !departureTime
        ) {
            Alert.alert('Required Fields', 'Please fill all required fields');
            return;
        }

        try {
            const tripData: Omit<TripFirestore, 'createdAt'> = {
                truck: vehicleNo.trim().toUpperCase(),
                status: `${fromPlant.trim()} → ${toPlant.trim()}${arrivalTime ? ' (Delivered)' : ' (En route)'}`,
                time: 'Just now',
                bidNo: lrNo.trim(),
                quantity: quantity.trim(),
                departureTime: departureTime!,
                arrivalTime: arrivalTime,
                fuelFilled: fuelFilled.trim() || '0',
                userId: user?.uid || '',
                driverName: driverName.trim(),
                fromPlant: fromPlant.trim(),
                toPlant: toPlant.trim(),
                companyName: companyName.trim(),
                itemType: itemType.trim(),
            };

            await addTrip(tripData);
            Alert.alert('Success', `Trip added for ${vehicleNo.toUpperCase()}`);

            resetAddForm();
            await loadTrips();
            setAddModalVisible(false);
        } catch (error) {
            console.error('Error adding trip:', error);
            Alert.alert('Error', 'Failed to add trip');
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
            setEditFromPlant(selectedTrip.fromPlant);
            setEditToPlant(selectedTrip.toPlant);
            setEditDepartureTime(selectedTrip.departureTime);
            setEditArrivalTime(selectedTrip.arrivalTime);
            setIsEditing(true);
        }
    };

    const handleSaveEdit = async () => {
        if (!selectedTrip) return;

        if (
            !editVehicleNo.trim() ||
            !editLrNo.trim() ||
            !editDriverName.trim() ||
            !editCompanyName.trim() ||
            !editItemType.trim() ||
            !editQuantity.trim() ||
            !editFromPlant.trim() ||
            !editToPlant.trim() ||
            !editDepartureTime
        ) {
            Alert.alert('Error', 'Please fill all required fields');
            return;
        }

        try {
            const updatedData: Partial<TripFirestore> = {
                truck: editVehicleNo.trim().toUpperCase(),
                bidNo: editLrNo.trim(),
                driverName: editDriverName.trim(),
                companyName: editCompanyName.trim(),
                itemType: editItemType.trim(),
                quantity: editQuantity.trim(),
                fuelFilled: editFuelFilled.trim() || '0',
                departureTime: editDepartureTime!,
                arrivalTime: editArrivalTime,
                fromPlant: editFromPlant.trim(),
                toPlant: editToPlant.trim(),
                status: `${editFromPlant.trim()} → ${editToPlant.trim()}${editArrivalTime ? ' (Delivered)' : ' (En route)'}`,
            };

            await updateTrip(selectedTrip.id, updatedData);
            Alert.alert('Success', 'Trip updated successfully');

            setIsEditing(false);
            setViewModalVisible(false);
            setSelectedTrip(null);
            await loadTrips();
        } catch (error) {
            console.error('Error updating trip:', error);
            Alert.alert('Error', 'Failed to update trip');
        }
    };

    const handleDeleteTrip = () => {
        if (!selectedTrip) return;

        Alert.alert('Delete Trip', 'Are you sure you want to delete this trip?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteTrip(selectedTrip.id);
                        Alert.alert('Success', 'Trip deleted');
                        setViewModalVisible(false);
                        setSelectedTrip(null);
                        await loadTrips();
                    } catch (error) {
                        console.error('Error deleting trip:', error);
                        Alert.alert('Error', 'Failed to delete trip');
                    }
                },
            },
        ]);
    };

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

                {/* Manager/Admin Section - Full Permissions */}
                {isUserManager && !checkingRole && (
                    <View style={styles.managerButtonsContainer}>
                        <TouchableOpacity
                            style={styles.adminButton}
                            onPress={() => navigation.navigate('DriverManagement')}
                        >
                            <Text style={styles.adminButtonText}>👥 Manage Drivers</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.adminButton, { backgroundColor: '#dc2626' }]}
                            onPress={() => navigation.navigate('UserManagement')}
                        >
                            <Text style={styles.adminButtonText}>👤 Manage Users</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.addDriverButton}
                            onPress={() => navigation.navigate('DriverManagement')}
                        >
                            <Text style={styles.addDriverButtonText}>➕ Add Driver</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Stats */}
                <View style={styles.statsGrid}>
                    {[
                        { title: 'Total Trucks', value: '24', color: '#1d4ed8' },
                        { title: 'Active Trips', value: trips.length.toString(), color: '#16a34a' },
                        { title: 'Drivers Online', value: '15', color: '#ea580c' },
                        { title: 'Pending Loads', value: '7', color: '#7c3aed' },
                    ].map((stat, i) => (
                        <View key={i} style={styles.statCard}>
                            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
                            <Text style={styles.statTitle}>{stat.title}</Text>
                        </View>
                    ))}
                </View>

                {/* Recent Trips */}
                <Text style={styles.sectionTitle}>Recent Trips</Text>
                <View style={styles.activityList}>
                    {loading ? (
                        <Text style={styles.emptyText}>Loading...</Text>
                    ) : trips.length === 0 ? (
                        <Text style={styles.emptyText}>No trips yet</Text>
                    ) : (
                        trips.map((trip) => (
                            <TouchableOpacity
                                key={trip.id}
                                style={styles.activityItem}
                                onPress={() => handleTripPress(trip)}
                            >
                                <View style={styles.activityDot} />

                                <View style={styles.activityContent}>
                                    {/* Row 1: Vehicle + Driver */}
                                    <Text style={styles.tripMainText}>
                                        {trip.truck}
                                        {trip.driverName ? (
                                            <Text style={styles.driverName}>
                                                {' '}({trip.driverName.split(' ')[0]})
                                            </Text>
                                        ) : null}
                                    </Text>

                                    {/* Row 2: Route */}
                                    <Text style={styles.routeText}>
                                        {trip.fromPlant || 'N/A'} → {trip.toPlant || 'N/A'}
                                    </Text>

                                    {/* Row 3: Times */}
                                    <Text style={styles.timeText}>
                                        {formatDateTime(trip.departureTime)}
                                        {' → '}
                                        {trip.arrivalTime
                                            ? formatDateTime(trip.arrivalTime)
                                            : 'Ongoing'}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        ))
                    )}
                </View>
            </ScrollView>

            {/* Floating Action Button */}
            <TouchableOpacity style={styles.fab} onPress={() => setAddModalVisible(true)}>
                <Text style={styles.fabText}>+</Text>
            </TouchableOpacity>

            {/* ======================== ADD TRIP MODAL ======================== */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={addModalVisible}
                onRequestClose={() => {
                    resetAddForm();
                    setAddModalVisible(false);
                }}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <View style={styles.modalContentWide}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            <Text style={styles.modalTitle}>Add New Trip</Text>

                            {/* Row 1 */}
                            <View style={styles.twoColumnRow}>
                                <TextInput
                                    style={styles.halfInput}
                                    placeholder="Vehicle Number *"
                                    value={vehicleNo}
                                    onChangeText={setVehicleNo}
                                    autoCapitalize="characters"
                                />
                                <TextInput
                                    style={styles.halfInput}
                                    placeholder="LR No *"
                                    value={lrNo}
                                    onChangeText={setLrNo}
                                />
                            </View>

                            {/* Row 2 */}
                            <View style={styles.twoColumnRow}>
                                <TextInput
                                    style={styles.halfInput}
                                    placeholder="Driver Name *"
                                    value={driverName}
                                    onChangeText={setDriverName}
                                    autoCapitalize="words"
                                />
                                <TextInput
                                    style={styles.halfInput}
                                    placeholder="Company Name *"
                                    value={companyName}
                                    onChangeText={setCompanyName}
                                />
                            </View>

                            {/* Row 3 */}
                            <View style={styles.twoColumnRow}>
                                <TextInput
                                    style={styles.halfInput}
                                    placeholder="Item Type *"
                                    value={itemType}
                                    onChangeText={setItemType}
                                />
                                <TextInput
                                    style={styles.halfInput}
                                    placeholder="Quantity (tons) *"
                                    value={quantity}
                                    onChangeText={setQuantity}
                                    keyboardType="numeric"
                                />
                            </View>

                            {/* Plants - Dropdown + Custom input */}
                            {/* Plants - Autocomplete TextInput */}
                            {/* Plants - Autocomplete */}
                            <View style={styles.twoColumnRow}>
                                {/* From Plant */}
                                <View style={[styles.inputWithSuggestions, { flex: 1, marginHorizontal: 4 }]}>
                                    <TextInput
                                        style={styles.halfInput}
                                        placeholder="From Plant..."
                                        value={fromPlant}
                                        onChangeText={(text) => {
                                            setFromPlant(text);
                                            setFromSuggestions(text.trim() ? getSuggestions(text) : []);
                                        }}
                                        autoCapitalize="words"
                                    />
                                    {fromSuggestions.length > 0 && (
                                        <View style={styles.suggestionsContainer}>
                                            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                                {fromSuggestions.map((plant, index) => (
                                                    <TouchableOpacity
                                                        key={index}
                                                        style={[
                                                            styles.suggestionItem,
                                                            index === fromSuggestions.length - 1 && styles.suggestionItemLast,
                                                        ]}
                                                        onPress={() => {
                                                            setFromPlant(plant);
                                                            setFromSuggestions([]);
                                                        }}
                                                    >
                                                        <Text style={styles.suggestionText}>{plant}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                        </View>
                                    )}
                                </View>

                                {/* To Plant */}
                                <View style={[styles.inputWithSuggestions, { flex: 1, marginHorizontal: 4 }]}>
                                    <TextInput
                                        style={styles.halfInput}
                                        placeholder="To plant..."
                                        value={toPlant}
                                        onChangeText={(text) => {
                                            setToPlant(text);
                                            setToSuggestions(text.trim() ? getSuggestions(text) : []);
                                        }}
                                        autoCapitalize="words"
                                    />
                                    {toSuggestions.length > 0 && (
                                        <View style={styles.suggestionsContainer}>
                                            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                                {toSuggestions.map((plant, index) => (
                                                    <TouchableOpacity
                                                        key={index}
                                                        style={[
                                                            styles.suggestionItem,
                                                            index === toSuggestions.length - 1 && styles.suggestionItemLast,
                                                        ]}
                                                        onPress={() => {
                                                            setToPlant(plant);
                                                            setToSuggestions([]);
                                                        }}
                                                    >
                                                        <Text style={styles.suggestionText}>{plant}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </ScrollView>
                                        </View>
                                    )}
                                </View>
                            </View>

                            {/* Row 5 - Times */}
                            <View style={styles.twoColumnRow}>
                                <TouchableOpacity
                                    style={styles.halfDateButton}
                                    onPress={() => {
                                        setTempDepartureDate(departureTime || new Date());
                                        setShowDeparturePicker(true);
                                    }}
                                >
                                    <Text style={[styles.dateText, departureTime && styles.dateTextSelected]}>
                                        {departureTime ? formatDateTime(departureTime) : 'Departure *'}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.halfDateButton}
                                    onPress={() => {
                                        setTempArrivalDate(arrivalTime || new Date());
                                        setShowArrivalPicker(true);
                                    }}
                                >
                                    <Text style={[styles.dateText, arrivalTime && styles.dateTextSelected]}>
                                        {arrivalTime ? formatDateTime(arrivalTime) : 'Arrival'}
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Fuel */}
                            <TextInput
                                style={styles.modalInput}
                                placeholder="Fuel Filled (liters)"
                                value={fuelFilled}
                                onChangeText={setFuelFilled}
                                keyboardType="numeric"
                            />

                            {/* Date Pickers */}
                            {showDeparturePicker && (
                                <Modal transparent visible={showDeparturePicker}>
                                    <View style={pickerModalStyles.overlay}>
                                        <View style={pickerModalStyles.container}>
                                            <DateTimePicker
                                                value={tempDepartureDate}
                                                mode="datetime"
                                                display="spinner"
                                                onChange={(e, date) => {
                                                    if (Platform.OS === 'android') setShowDeparturePicker(false);
                                                    if (date) setTempDepartureDate(date);
                                                }}
                                            />
                                            {Platform.OS === 'ios' && (
                                                <Pressable
                                                    style={pickerModalStyles.doneButton}
                                                    onPress={() => {
                                                        setDepartureTime(tempDepartureDate);
                                                        setShowDeparturePicker(false);
                                                    }}
                                                >
                                                    <Text style={pickerModalStyles.doneText}>Done</Text>
                                                </Pressable>
                                            )}
                                        </View>
                                    </View>
                                </Modal>
                            )}

                            {showArrivalPicker && (
                                <Modal transparent visible={showArrivalPicker}>
                                    <View style={pickerModalStyles.overlay}>
                                        <View style={pickerModalStyles.container}>
                                            <DateTimePicker
                                                value={tempArrivalDate}
                                                mode="datetime"
                                                display="spinner"
                                                onChange={(e, date) => {
                                                    if (Platform.OS === 'android') setShowArrivalPicker(false);
                                                    if (date) setTempArrivalDate(date);
                                                }}
                                            />
                                            {Platform.OS === 'ios' && (
                                                <Pressable
                                                    style={pickerModalStyles.doneButton}
                                                    onPress={() => {
                                                        setArrivalTime(tempArrivalDate);
                                                        setShowArrivalPicker(false);
                                                    }}
                                                >
                                                    <Text style={pickerModalStyles.doneText}>Done</Text>
                                                </Pressable>
                                            )}
                                        </View>
                                    </View>
                                </Modal>
                            )}

                            {/* Buttons */}
                            <View style={styles.modalButtons}>
                                <Pressable
                                    style={[styles.modalButton, styles.cancelButton]}
                                    onPress={() => {
                                        resetAddForm();
                                        setAddModalVisible(false);
                                    }}
                                >
                                    <Text style={styles.cancelText}>Cancel</Text>
                                </Pressable>
                                <Pressable
                                    style={[styles.modalButton, styles.saveButton]}
                                    onPress={handleAddTrip}
                                >
                                    <Text style={styles.saveText}>Save</Text>
                                </Pressable>
                            </View>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* ======================== VIEW / EDIT MODAL ======================== */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={viewModalVisible}
                onRequestClose={() => {
                    setViewModalVisible(false);
                    setIsEditing(false);
                }}
            >
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalContentWide}>
                        <ScrollView showsVerticalScrollIndicator={false}>
                            <Text style={styles.modalTitle}>{isEditing ? 'Edit Trip' : 'Trip Details'}</Text>

                            {isEditing ? (
                                <>
                                    {/* Edit Form - Two column layout */}
                                    <View style={styles.twoColumnRow}>
                                        <TextInput
                                            style={styles.halfInput}
                                            value={editVehicleNo}
                                            onChangeText={setEditVehicleNo}
                                            placeholder="Vehicle Number *"
                                            autoCapitalize="characters"
                                        />
                                        <TextInput
                                            style={styles.halfInput}
                                            value={editLrNo}
                                            onChangeText={setEditLrNo}
                                            placeholder="LR No *"
                                        />
                                    </View>

                                    <View style={styles.twoColumnRow}>
                                        <TextInput
                                            style={styles.halfInput}
                                            value={editDriverName}
                                            onChangeText={setEditDriverName}
                                            placeholder="Driver Name *"
                                            autoCapitalize="words"
                                        />
                                        <TextInput
                                            style={styles.halfInput}
                                            value={editCompanyName}
                                            onChangeText={setEditCompanyName}
                                            placeholder="Company Name *"
                                        />
                                    </View>

                                    <View style={styles.twoColumnRow}>
                                        <TextInput
                                            style={styles.halfInput}
                                            value={editItemType}
                                            onChangeText={setEditItemType}
                                            placeholder="Item Type *"
                                        />
                                        <TextInput
                                            style={styles.halfInput}
                                            value={editQuantity}
                                            onChangeText={setEditQuantity}
                                            placeholder="Quantity (tons) *"
                                            keyboardType="numeric"
                                        />
                                    </View>

                                    {/* Plants - Edit */}
                                    <View style={styles.twoColumnRow}>
                                        {/* From Plant Edit */}
                                        <View style={[styles.inputWithSuggestions, { flex: 1, marginHorizontal: 4 }]}>
                                            <TextInput
                                                style={styles.halfInput}
                                                placeholder="Type plant name..."
                                                value={editFromPlant}
                                                onChangeText={(text) => {
                                                    setEditFromPlant(text);
                                                    setEditFromSuggestions(text.trim() ? getSuggestions(text) : []);
                                                }}
                                                autoCapitalize="words"
                                            />
                                            {editFromSuggestions.length > 0 && (
                                                <View style={styles.suggestionsContainer}>
                                                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                                        {editFromSuggestions.map((plant, index) => (
                                                            <TouchableOpacity
                                                                key={index}
                                                                style={[
                                                                    styles.suggestionItem,
                                                                    index === editFromSuggestions.length - 1 && styles.suggestionItemLast,
                                                                ]}
                                                                onPress={() => {
                                                                    setEditFromPlant(plant);
                                                                    setEditFromSuggestions([]);
                                                                }}
                                                            >
                                                                <Text style={styles.suggestionText}>{plant}</Text>
                                                            </TouchableOpacity>
                                                        ))}
                                                    </ScrollView>
                                                </View>
                                            )}
                                        </View>

                                        {/* To Plant Edit */}
                                        <View style={[styles.inputWithSuggestions, { flex: 1, marginHorizontal: 4 }]}>
                                            <TextInput
                                                style={styles.halfInput}
                                                placeholder="To plant..."
                                                value={editToPlant}
                                                onChangeText={(text) => {
                                                    setEditToPlant(text);
                                                    setEditToSuggestions(text.trim() ? getSuggestions(text) : []);
                                                }}
                                                autoCapitalize="words"
                                            />
                                            {editToSuggestions.length > 0 && (
                                                <View style={styles.suggestionsContainer}>
                                                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                                        {editToSuggestions.map((plant, index) => (
                                                            <TouchableOpacity
                                                                key={index}
                                                                style={[
                                                                    styles.suggestionItem,
                                                                    index === editToSuggestions.length - 1 && styles.suggestionItemLast,
                                                                ]}
                                                                onPress={() => {
                                                                    setEditToPlant(plant);
                                                                    setEditToSuggestions([]);
                                                                }}
                                                            >
                                                                <Text style={styles.suggestionText}>{plant}</Text>
                                                            </TouchableOpacity>
                                                        ))}
                                                    </ScrollView>
                                                </View>
                                            )}
                                        </View>
                                    </View>

                                    <View style={styles.twoColumnRow}>
                                        <TouchableOpacity
                                            style={styles.halfDateButton}
                                            onPress={() => {
                                                setTempDepartureDate(editDepartureTime || new Date());
                                                setShowDeparturePicker(true);
                                            }}
                                        >
                                            <Text style={[styles.dateText, editDepartureTime && styles.dateTextSelected]}>
                                                {editDepartureTime ? formatDateTime(editDepartureTime) : 'Departure *'}
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={styles.halfDateButton}
                                            onPress={() => {
                                                setTempArrivalDate(editArrivalTime || new Date());
                                                setShowArrivalPicker(true);
                                            }}
                                        >
                                            <Text style={[styles.dateText, editArrivalTime && styles.dateTextSelected]}>
                                                {editArrivalTime ? formatDateTime(editArrivalTime) : 'Arrival'}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>

                                    <TextInput
                                        style={styles.modalInput}
                                        value={editFuelFilled}
                                        onChangeText={setEditFuelFilled}
                                        placeholder="Fuel Filled (liters)"
                                        keyboardType="numeric"
                                    />

                                    {/* Edit date pickers */}
                                    {showDeparturePicker && (
                                        <Modal transparent visible={showDeparturePicker}>
                                            <View style={pickerModalStyles.overlay}>
                                                <View style={pickerModalStyles.container}>
                                                    <DateTimePicker
                                                        value={tempDepartureDate}
                                                        mode="datetime"
                                                        display="spinner"
                                                        onChange={(e, date) => {
                                                            if (Platform.OS === 'android') setShowDeparturePicker(false);
                                                            if (date) setTempDepartureDate(date);
                                                        }}
                                                    />
                                                    {Platform.OS === 'ios' && (
                                                        <Pressable
                                                            style={pickerModalStyles.doneButton}
                                                            onPress={() => {
                                                                setEditDepartureTime(tempDepartureDate);
                                                                setShowDeparturePicker(false);
                                                            }}
                                                        >
                                                            <Text style={pickerModalStyles.doneText}>Done</Text>
                                                        </Pressable>
                                                    )}
                                                </View>
                                            </View>
                                        </Modal>
                                    )}

                                    {showArrivalPicker && (
                                        <Modal transparent visible={showArrivalPicker}>
                                            <View style={pickerModalStyles.overlay}>
                                                <View style={pickerModalStyles.container}>
                                                    <DateTimePicker
                                                        value={tempArrivalDate}
                                                        mode="datetime"
                                                        display="spinner"
                                                        onChange={(e, date) => {
                                                            if (Platform.OS === 'android') setShowArrivalPicker(false);
                                                            if (date) setTempArrivalDate(date);
                                                        }}
                                                    />
                                                    {Platform.OS === 'ios' && (
                                                        <Pressable
                                                            style={pickerModalStyles.doneButton}
                                                            onPress={() => {
                                                                setEditArrivalTime(tempArrivalDate);
                                                                setShowArrivalPicker(false);
                                                            }}
                                                        >
                                                            <Text style={pickerModalStyles.doneText}>Done</Text>
                                                        </Pressable>
                                                    )}
                                                </View>
                                            </View>
                                        </Modal>
                                    )}

                                    <View style={styles.modalButtons}>
                                        <Pressable
                                            style={[styles.modalButton, styles.cancelButton]}
                                            onPress={() => setIsEditing(false)}
                                        >
                                            <Text style={styles.cancelText}>Cancel</Text>
                                        </Pressable>
                                        <Pressable
                                            style={[styles.modalButton, styles.saveButton]}
                                            onPress={handleSaveEdit}
                                        >
                                            <Text style={styles.saveText}>Save</Text>
                                        </Pressable>
                                    </View>
                                </>
                            ) : (
                                /* View Mode */
                                <>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Vehicle:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.truck}</Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>LR No:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.bidNo}</Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Driver:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.driverName}</Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Company:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.companyName}</Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Item:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.itemType}</Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Quantity:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.quantity} tons</Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>From → To:</Text>
                                        <Text style={styles.detailValue}>
                                            {selectedTrip?.fromPlant} → {selectedTrip?.toPlant}
                                        </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Departure:</Text>
                                        <Text style={styles.detailValue}>
                                            {formatDateTime(selectedTrip?.departureTime || null)}
                                        </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Arrival:</Text>
                                        <Text style={styles.detailValue}>
                                            {formatDateTime(selectedTrip?.arrivalTime || null) || 'Not arrived'}
                                        </Text>
                                    </View>
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailLabel}>Fuel:</Text>
                                        <Text style={styles.detailValue}>{selectedTrip?.fuelFilled} L</Text>
                                    </View>

                                    <View style={styles.viewModalButtons}>
                                        <Pressable
                                            style={[styles.modalButton, styles.editButtonStyle]}
                                            onPress={handleEditPress}
                                        >
                                            <Text style={styles.editButtonText}>Edit</Text>
                                        </Pressable>
                                        <Pressable
                                            style={[styles.modalButton, styles.deleteButtonStyle]}
                                            onPress={handleDeleteTrip}
                                        >
                                            <Text style={styles.deleteButtonText}>Delete</Text>
                                        </Pressable>
                                    </View>

                                    <Pressable
                                        style={styles.closeButton}
                                        onPress={() => {
                                            setViewModalVisible(false);
                                            setIsEditing(false);
                                        }}
                                    >
                                        <Text style={styles.cancelText}>Close</Text>
                                    </Pressable>
                                </>
                            )}
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

/* ────────────────────────────────────────────────────────────── */
/* Styles (updated & cleaned) */
const styles = {
    container: { flex: 1, backgroundColor: '#f3f4f6' } as const,
    scrollContent: { padding: 20, paddingBottom: 100 } as const,
    header: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'center' as const,
        marginBottom: 24,
    },
    welcomeText: { fontSize: 28, fontWeight: '700' as const, color: '#111827' },
    emailText: { fontSize: 16, color: '#6b7280', marginTop: 4 },
    logoutButton: {
        backgroundColor: '#ef4444',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
    },
    logoutText: { color: '#fff', fontWeight: '600' as const },

    statsGrid: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        justifyContent: 'space-between' as const,
        marginBottom: 32,
    },
    statCard: {
        backgroundColor: '#fff',
        width: '48%' as const,
        padding: 20,
        borderRadius: 12,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    statValue: { fontSize: 36, fontWeight: '700' as const },
    statTitle: { fontSize: 14, color: '#6b7280', marginTop: 8 },

    sectionTitle: {
        fontSize: 20,
        fontWeight: '600' as const,
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
    managerButtonsContainer: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: 12,
        marginBottom: 20,
    },
    adminButton: {
        flex: 1,
        minWidth: 150,
        backgroundColor: '#10b981',
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: 'center' as const,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    adminButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700' as const,
    },
    addDriverButton: {
        flex: 1,
        minWidth: 150,
        backgroundColor: '#3b82f6',
        borderRadius: 10,
        paddingVertical: 14,
        alignItems: 'center' as const,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    addDriverButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700' as const,
    },
    activityItem: {
        flexDirection: 'row' as const,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    inputWithSuggestions: {
        position: 'relative' as const,
    },
    activityDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#1d4ed8',
        marginRight: 14,
        marginTop: 10,
    },
    activityContent: {
        flex: 1,
    },
    tripHeader: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        alignItems: 'center' as const,
        marginBottom: 4,
    },
    suggestionsContainer: {
        position: 'absolute' as const,
        top: 52,
        left: 0,
        right: 0,
        zIndex: 100,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 10,
        maxHeight: 200,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
    },
    suggestionItem: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    suggestionItemLast: {
        borderBottomWidth: 0,
    },
    suggestionText: {
        fontSize: 15,
        color: '#111827',
    },
    tripMainText: {
        fontSize: 16,
        fontWeight: '600' as const,
        color: '#111827',
        marginBottom: 4,
    },
    driverName: {
        fontSize: 15,
        fontWeight: '500' as const,
        color: '#4b5563',
    },
    truckName: { fontSize: 16, fontWeight: '600' as const, color: '#111827', flex: 1 },
    routeText: {
        fontSize: 14,
        color: '#1d4ed8',
        fontWeight: '500' as const,
        marginBottom: 4,
    },
    timeText: {
        fontSize: 13,
        color: '#6b7280',
    },
    statusText: { fontSize: 13, color: '#6b7280' },
    fab: {
        position: 'absolute' as const,
        right: 20,
        bottom: 30,
        backgroundColor: '#1d4ed8',
        width: 60,
        height: 60,
        borderRadius: 30,
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
        elevation: 8,
    },
    fabText: { color: '#fff', fontSize: 32, fontWeight: '300' as const },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center' as const,
        alignItems: 'center' as const,
    },
    modalContentWide: {
        backgroundColor: '#fff',
        width: '92%' as const,
        maxHeight: '88%' as const,
        borderRadius: 16,
        padding: 20,
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: '700' as const,
        color: '#111827',
        textAlign: 'center' as const,
        marginBottom: 16,
    },
    twoColumnRow: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        marginBottom: 14,
    },
    halfInput: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 12,
        fontSize: 15,
        backgroundColor: '#f9fafb',
        marginHorizontal: 4,
    },
    halfDateButton: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 14,
        backgroundColor: '#f9fafb',
        marginHorizontal: 4,
        justifyContent: 'center' as const,
    },
    modalInput: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 15,
        backgroundColor: '#f9fafb',
        marginBottom: 14,
    },
    dateText: { fontSize: 15, color: '#9ca3af' },
    dateTextSelected: { color: '#111827', fontWeight: '500' as const },
    modalButtons: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        marginTop: 20,
        gap: 12,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center' as const,
    },
    cancelButton: { backgroundColor: '#e5e7eb' },
    saveButton: { backgroundColor: '#1d4ed8' },
    cancelText: { color: '#374151', fontWeight: '600' as const },
    saveText: { color: '#fff', fontWeight: '700' as const },

    detailRow: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    detailLabel: {
        fontSize: 15,
        fontWeight: '600' as const,
        color: '#374151',
        flex: 1,
    },
    detailValue: {
        fontSize: 15,
        color: '#111827',
        flex: 1,
        textAlign: 'right' as const,
    },
    viewModalButtons: {
        flexDirection: 'row' as const,
        justifyContent: 'space-between' as const,
        marginTop: 24,
        gap: 12,
    },
    editButtonStyle: { backgroundColor: '#1d4ed8' },
    editButtonText: { color: '#fff', fontWeight: '700' as const },
    deleteButtonStyle: { backgroundColor: '#ef4444' },
    deleteButtonText: { color: '#fff', fontWeight: '700' as const },
    closeButton: {
        backgroundColor: '#e5e7eb',
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center' as const,
        marginTop: 16,
    },
    emptyText: {
        textAlign: 'center' as const,
        color: '#9ca3af',
        fontSize: 16,
        padding: 40,
    },
};

const pickerModalStyles = {
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end' as const,
    },
    container: {
        backgroundColor: 'white',
        paddingTop: 16,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    doneButton: {
        paddingVertical: 16,
        alignItems: 'center' as const,
        backgroundColor: '#f0f0f0',
        borderTopWidth: 1,
        borderTopColor: '#ddd',
    },
    doneText: {
        fontSize: 18,
        color: '#007AFF',
        fontWeight: '600' as const,
    },
    fieldLabel: {
        fontSize: 14,
        fontWeight: '500' as const,
        color: '#374151',
        marginBottom: 6,
    },
    pickerWrapper: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        backgroundColor: '#f9fafb',
        overflow: 'hidden' as const,
    },
    picker: {
        height: 50,
        width: '100%' as const,
        color: '#111827',
    },
};