// lib/config.js — Central config (mirrors GAS CONFIG + SHEETS + COL constants)

export const CONFIG = {
  SOURCE_SHEET_ID  : process.env.SOURCE_SHEET_ID,
  SOURCE_SHEET_NAME: 'Outsourcing Leads Generation',
  PAYMENT_STATUS_SHEET_ID: '1-o2vpphU2kvykz63jjes8Afuha-Fol_UoBQt5nmPtco',
  PAYMENT_STATUS_SHEET_NAME: 'payment status',
  CRM_SHEET_ID     : process.env.CRM_SHEET_ID,
  SESSION_TTL_SEC  : (parseInt(process.env.SESSION_TTL_HOURS) || 8) * 3600,
  CACHE_TTL_SEC    : 300,
  PAGE_SIZE        : 50,
  APP_TITLE        : 'ICO Center Portal',
  WEBFORM_URL      : process.env.WEBFORM_URL || '',
};

export const SHEETS = {
  USERS        : 'USERS',
  NOTES_LOG    : 'NOTES_LOG',
  AUDIT_LOG    : 'AUDIT_LOG',
  NOTIFICATIONS: 'NOTIFICATIONS',
  ACTIVITY_LOG : 'ACTIVITY_LOG',
  LEAD_ID_MAP  : 'LEAD_ID_MAP',
  INCENTIVES   : 'INCENTIVES',
};

// Sheet headers used during bootstrap (auto-create missing sheets)
export const SHEET_HEADERS = {
  USERS        : ['Username','Password','Role','Status','Created At'],
  NOTES_LOG    : ['Timestamp','Lead ID','Center Code','Note Content','Created By'],
  AUDIT_LOG    : ['Timestamp','Lead ID','Field Name','Old Value','New Value','Changed By'],
  NOTIFICATIONS: ['Notification ID','Center Code','Lead ID','Message JSON','Status','Timestamp'],
  ACTIVITY_LOG : ['Timestamp','User','Action','Details'],
  LEAD_ID_MAP  : ['Source Row','Lead ID','Center Code','Watch Hash','Watch Values JSON','Created At'],
  INCENTIVES   : ['ID','Prize Label','Weekly Target','Rules','Who Included','Active','Created By','Created At'],
  'payment status' : ['Lead ID','Payment Status','Updated By','Updated At'],
};

// Source sheet column indices (0-based)
export const COL = {
  DATE                      : 0,
  CENTER_CODE               : 1,
  CENTER_NAME               : 2,
  CLOSER_NAME               : 3,
  LEAD_STATUS               : 4,
  CLOSING_NOTES             : 5,
  CHASER_NAME               : 6,
  CHASER_STATUS             : 7,
  CHASER_NOTE               : 8,
  PROCESSING_STATUS_CENTERS : 9,
  PROCESSING_STATUS_ICO     : 10,
  SNS_RESULT                : 11,
  LEAD_TYPE                 : 12,
  REQUESTED_PRODUCTS        : 13,
  FIRST_NAME                : 14,
  LAST_NAME                 : 15,
  PHONE                     : 16,
  ADDRESS                   : 17,
  CITY                      : 18,
  STATE                     : 19,
  ZIP                       : 20,
  DOB                       : 21,
  MED_ID                    : 22,
  HEIGHT                    : 23,
  WEIGHT                    : 24,
  SHOE_SIZE                 : 25,
  WAIST_SIZE                : 26,
  GENDER                    : 27,
  DOCTOR_NAME               : 28,
  DOCTOR_PHONE              : 29,
  DOCTOR_FAX                : 30,
  DOCTOR_NPI                : 31,
  PROCESSING_HISTORY        : 39,
  APPROVAL_DATE             : 40,
};

export const PCP_SOURCE_SHEET_NAME = 'Outsourcing PCP Processing';

export const PCP_COL = {
  TIMESTAMP          : 0,
  CENTER_CODE        : 1,
  CENTER_NAME        : 2,
  CLOSER_NAME        : 3,
  DOCa_REVIEW        : 4,
  NOTE               : 5,
  PROC_STATUS_CENTERS: 6,
  PROC_STATUS_ICO    : 7,
  SNS_RESULT         : 8,
  LEAD_TYPE          : 9,
  REQUESTED_PRODUCTS : 10,
  FIRST_NAME         : 11,
  LAST_NAME          : 12,
  PHONE              : 13,
  GENDER             : 14,
  ADDRESS            : 15,
  CITY               : 16,
  STATE              : 17,
  ZIP                : 18,
  DOB                : 19,
  MED_ID             : 20,
  HEIGHT             : 21,
  WEIGHT             : 22,
  SHOE_SIZE          : 23,
  WAIST_SIZE         : 24,
  DOCTOR_NAME        : 25,
  DOCTOR_NPI         : 26,
  DOCTOR_PHONE       : 27,
  DOCTOR_FAX         : 28,
  DOCTOR_ADDRESS     : 29,
  DO_LINK            : 30,
  CN_LINK            : 31,
  RECORD_LINK        : 32,
  PROCESSING_HISTORY : 36,
  PROC_STATUS_AN     : 39,
  SHIPPED_DATE       : 42,
};

export const DISPOSITIONS = {
  LEAD_PRODUCTION : ['Verified ppo', 'Verified Med b'],
  CHASER_SIGNED   : ['Order Signed'],
  CHASER_POTENTIAL: ['Trial', 'Missing CN', 'Missing DO'],
  PROC_APPROVED   : ['APPROVED'],
  PROC_INPROCESS  : ['IN PROCESS'],
  PROC_DENIED     : ['DENIED'],
  PROC_RTS        : ['SHIPPED RTS'],
};

export const WATCHED_FIELDS = [
  { col: COL.LEAD_STATUS,                name: 'Lead Status'       },
  { col: COL.CLOSING_NOTES,             name: 'Closing Notes'     },
  { col: COL.CHASER_NAME,               name: 'Chaser Name'       },
  { col: COL.CHASER_STATUS,             name: 'Chaser Status'     },
  { col: COL.CHASER_NOTE,               name: 'Chaser Note'       },
  { col: COL.PROCESSING_STATUS_CENTERS, name: 'Processing Status' },
];
