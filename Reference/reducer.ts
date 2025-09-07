import {
    ActionType,
    UploadStatus,
    MEASUREMENT_INITIAL_SET,
    SUCCESS_MESSAGES
} from './constants';
import { MeasurementAction, MeasurementState } from './types';

export const initialMeasurementState: MeasurementState = {
    selectedSession: null,
    selectedExercise: null,
    recordingStartTime: null,
    lastRecordingStartTime: null,
    currentSet: MEASUREMENT_INITIAL_SET,
    completedSets: new Set(),
    uploadStatus: null,
    uploadMessage: ''
};

const resetUploadState = (state: MeasurementState): MeasurementState => ({
    ...state,
    uploadStatus: null,
    uploadMessage: ''
});

const addCompletedSet = (state: MeasurementState): MeasurementState => ({
    ...state,
    completedSets: new Set([...state.completedSets, state.currentSet])
});

export const measurementReducer = (
    state: MeasurementState,
    action: MeasurementAction
): MeasurementState => {
    switch (action.type) {
        case ActionType.SET_SESSION_EXERCISE:
            return resetUploadState({
                ...state,
                selectedSession: action.payload.session,
                selectedExercise: action.payload.exercise,
                currentSet: MEASUREMENT_INITIAL_SET,
                completedSets: new Set(),
                lastRecordingStartTime: null
            });

        case ActionType.SET_COMPLETED_SETS:
            return {
                ...state,
                completedSets: new Set(action.payload)
            };

        case ActionType.START_RECORDING:
            return resetUploadState({
                ...state,
                recordingStartTime: action.payload.startTime
            });

        case ActionType.STOP_RECORDING:
            return {
                ...state,
                lastRecordingStartTime: state.recordingStartTime,
                uploadStatus: UploadStatus.UPLOADING,
                uploadMessage: SUCCESS_MESSAGES.UPLOAD_IN_PROGRESS
            };

        case ActionType.UPLOAD_SUCCESS:
            return {
                ...addCompletedSet(state),
                uploadStatus: UploadStatus.SUCCESS,
                uploadMessage: SUCCESS_MESSAGES.RECORDING_UPLOADED
            };

        case ActionType.UPLOAD_PARTIAL:
            return {
                ...addCompletedSet(state),
                uploadStatus: UploadStatus.PARTIAL,
                uploadMessage: action.payload.message
            };

        case ActionType.UPLOAD_FAILED:
            return {
                ...state,
                uploadStatus: UploadStatus.FAILED,
                uploadMessage: action.payload.message
            };

        case ActionType.CLEAR_UPLOAD_STATUS:
            return resetUploadState(state);

        case ActionType.SET_CURRENT_SET:
            return resetUploadState({
                ...state,
                currentSet: action.payload.setNumber
            });

        case ActionType.REMOVE_COMPLETED_SET: {
            const newCompletedSets = new Set(state.completedSets);
            newCompletedSets.delete(action.payload.setNumber);
            return {
                ...state,
                completedSets: newCompletedSets
            };
        }

        case ActionType.RESET_ALL:
            return initialMeasurementState;

        default:
            return state;
    }
};