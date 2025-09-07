/** Enum for action types used in state management. */
export enum ActionType {
    SET_SESSION_EXERCISE = 'SET_SESSION_EXERCISE',
    SET_COMPLETED_SETS = 'SET_COMPLETED_SETS',
    START_RECORDING = 'START_RECORDING',
    STOP_RECORDING = 'STOP_RECORDING',
    UPLOAD_SUCCESS = 'UPLOAD_SUCCESS',
    UPLOAD_PARTIAL = 'UPLOAD_PARTIAL',
    UPLOAD_FAILED = 'UPLOAD_FAILED',
    CLEAR_UPLOAD_STATUS = 'CLEAR_UPLOAD_STATUS',
    SET_CURRENT_SET = 'SET_CURRENT_SET',
    REMOVE_COMPLETED_SET = 'REMOVE_COMPLETED_SET',
    RESET_ALL = 'RESET_ALL'
}

/** Enum for upload status types. */
export enum UploadStatus {
    SUCCESS = 'success',
    PARTIAL = 'partial',
    FAILED = 'failed',
    UPLOADING = 'uploading'
}

/** Enum for notification positions. */
export enum NotificationPosition {
    TOP_LEFT = 'top-left',
    TOP_RIGHT = 'top-right',
    TOP_CENTER = 'top-center',
    BOTTOM_LEFT = 'bottom-left',
    BOTTOM_RIGHT = 'bottom-right'
}

export const ANIMATION_DURATION_MS = 300;
export const POSITION_DELAY_MS = 10;
export const TOAST_SUCCESS_DURATION_MS = 3000;
export const TOAST_ERROR_DURATION_MS = 3000;
export const TOAST_PARTIAL_DURATION_MS = 3000;
export const ASYNC_DELAY_MS = 0;
export const DEBUG_BUFFER_BEFORE_UI_TIME_MS = 2000;
export const DEBUG_BUFFER_BEFORE_DATA_TIME_MS = 1000;
export const DEBUG_DEFAULT_FALLBACK_HOURS = 1;
export const API_TIMEOUT_DEFAULT_MS = 5000;
export const API_TIMEOUT_UPLOAD_MS = 30000;
export const API_TIMEOUT_STREAMING_MS = 1000;

export const MEASUREMENT_INITIAL_SET = 1;
export const MEASUREMENT_DEFAULT_SETS_COUNT = 3;
export const MEASUREMENT_MAX_SETS = 10;
export const MEASUREMENT_MIN_SETS = 1;
export const MEASUREMENT_MAX_EXERCISES_PER_SESSION = 20;
export const DEVICE_TOTAL_COUNT = 4;
export const DEVICE_DATA_CURRENT_DEFAULT = 0;
export const DEVICE_DATA_MAX_DEFAULT = 0;
export const DEVICE_DATA_MIN_DEFAULT = 0;

/** Collection of error messages used in the application. */
export const ERROR_MESSAGES = {
    SESSION_EXERCISE_REQUIRED: 'Please select both session and exercise before recording',
    MOTION_RECORDING_FAILED: 'Failed to initialize motion recording',
    DEVICE_STREAMING_FAILED: 'Failed to start device streaming',
    MOTION_PROCESSING_ERROR: 'Motion processing system error',
    INITIALIZATION_FAILED: 'Initializing motion processing...',
    PATIENT_SELECTION_REQUIRED: 'Please select a patient to begin measurements',
    PAGE_RELOAD_REQUIRED: 'Reload Page',
    RECORDING_RESET_FAILED: 'Failed to reset recording session',
    RECORDING_FAILED_PREFIX: 'Recording failed: ',
    UPLOAD_FAILED_WITH_QUEUE: 'Recording failed to upload. {0} measurements queued for retry.',
    UPLOAD_FAILED_GENERAL: 'Upload failed. Please try again.'
} as const;

/** Collection of success messages used in the application. */
export const SUCCESS_MESSAGES = {
    RECORDING_UPLOADED: 'Recording uploaded successfully!',
    UPLOAD_IN_PROGRESS: 'Processing upload...',
    RECORDING_SAVED_WITH_QUEUE: 'Recording saved successfully. {0} measurements still processing.'
} as const;

/** Collection of confirmation messages used in the application. */
export const CONFIRMATION_MESSAGES = {
    RE_RECORDING_CONFIRM: 'has already been recorded. Do you want to record it again?'
} as const;

/** Collection of button text used in the application. */
export const BUTTON_TEXT = {
    STOP_RECORDING: 'Stop Recording',
    START_RECORDING: 'Start Recording',
    RESET: 'Reset',
    HIDE: 'Hide',
    SHOW: 'Show',
    COPY_JSON: 'Copy JSON',
    TEST_API: 'Test API',
    REFRESH: 'Refresh',
    LOG_TO_CONSOLE: 'Log to Console'
} as const;

/** Collection of ARIA labels used in the application. */
export const ARIA_LABELS = {
    SUCCESS: 'Success',
    PARTIAL_SUCCESS: 'Partial success',
    FAILED: 'Failed',
    UPLOADING: 'Uploading',
    INFORMATION: 'Information',
    DISMISS_NOTIFICATION: 'Dismiss notification',
    STOP_RECORDING: 'Stop recording',
    START_RECORDING: 'Start recording',
    RESET_SESSION: 'Reset recording session'
} as const;

/** Collection of UI text used in the application. */
export const UI_TEXT = {
    SET_PREFIX: 'Set ',
    UPLOAD_NOTIFICATION: 'Upload notification',
    DISMISS_SYMBOL: '×',
    NOT_AVAILABLE: 'N/A',
    ACTIVE: 'Active',
    STOPPED: 'Stopped',
    UPDATED_PREFIX: 'Updated: '
} as const;

/** Collection of device data keys. */
export const DEVICE_DATA_KEYS = {
    CURRENT: 'current',
    MAX: 'max',
    MIN: 'min',
    DEVICES: 'devices'
} as const;

/** Collection of API includes. */
export const API_INCLUDES = {
    SESSIONS: 'sessions',
    JOINTS: 'joints',
    MEASUREMENTS: 'measurements'
} as const;

/** Collection of color profiles. */
export const COLOR_PROFILES = {
    LEFT_KNEE: 'leftKnee',
    RIGHT_KNEE: 'rightKnee'
} as const;

/** Collection of chart sides. */
export const CHART_SIDES = {
    LEFT: 'Left',
    RIGHT: 'Right'
} as const;

/** Collection of time source types. */
export const TIME_SOURCE_TYPES = {
    CURRENT_RECORDING_WITH_BUFFER: 'current_recording_with_buffer',
    ACTUAL_DATA_TIMESTAMPS: 'actual_data_timestamps',
    PRESERVED_UI_WITH_BUFFER: 'preserved_ui_with_buffer',
    RECENT_RECORDING_FALLBACK: 'recent_recording_fallback',
    DEFAULT_1H_FALLBACK: 'default_1h_fallback'
} as const;

/** Collection of debug panel text. */
export const DEBUG_PANEL_TEXT = {
    TITLE: 'API Debug - Fetch Current Recording',
    SESSION_MISMATCH_WARNING: '⚠️ Session Mismatch',
    SELECT_SESSION_MESSAGE: 'Select session and exercise to generate API request',
    SESSION_LABEL: 'Session:',
    EXERCISE_LABEL: 'Exercise:',
    SET_LABEL: 'Set:',
    RECORDING_LABEL: 'Recording:',
    TIME_RANGE_LABEL: 'Time Range:',
    START_TIME_STATUS_LABEL: 'Start Time Status:',
    RECORDING_ID_LABEL: 'Recording ID:',
    JOINTS_LABEL: 'Joints:',
    SESSION_MATCH_LABEL: 'Session Match:',
    MATCH: '✅ Match',
    MISMATCH: '❌ Mismatch',
    USING_ACTUAL_DATA: '✅ Using Actual Data Timestamps',
    USING_BUFFERED_TIME: '🛡️ Using Buffered Time',
    USING_FALLBACK: '⚠️ Using Fallback',
    UNKNOWN_STATUS: '❓ Unknown'
} as const;

export const MESSAGE_PLACEHOLDER = '{0}';

/** Formats a message template with provided arguments. */
export const formatMessage = (template: string, ...args: (string | number)[]) => {
    return template.replace(/{(\d+)}/g, (match, index) => {
        const argIndex = parseInt(index, 10);
        return args[argIndex]?.toString() || match;
    });
};

/** Checks if a set number is valid. */
export const isValidSet = (setNumber: number) => {
    return setNumber >= MEASUREMENT_MIN_SETS && setNumber <= MEASUREMENT_MAX_SETS;
};

/** Checks if a notification position is valid. */
export const isValidNotificationPosition = (position: string): position is NotificationPosition => {
    return Object.values(NotificationPosition).includes(position as NotificationPosition);
};

/** Extracts joint IDs from recordings. */
export const extractJointIds = (recordings: any[]) => {
    const jointIds = new Set<string>();
    recordings.forEach(recording => {
        if (recording.joints_arr) {
            recording.joints_arr.forEach((joint: any) => {
                if (joint.id) {
                    jointIds.add(joint.id);
                }
            });
        }
    });
    return jointIds;
};

/** Extracts joint names from current angles. */
export const extractJointNames = (currentAngles: Map<string, number>) => Array.from(currentAngles.keys());

/** Gets joint IDs from coordinator and recent recordings. */
export const getJointIdsFromCoordinator = (coordinator: any, recentRecordings: any[] = []) => {
    const jointIds = new Set<string>();
    if (recentRecordings.length > 0) {
        const extractedIds = extractJointIds(recentRecordings);
        extractedIds.forEach(id => jointIds.add(id));
    }
    if (jointIds.size === 0 && coordinator?.getCurrentJointAngles) {
        const currentAngles = coordinator.getCurrentJointAngles();
        const jointNames = extractJointNames(currentAngles);
    }
    return jointIds;
};