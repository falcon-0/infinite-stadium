// Shared measurement semantics over explicit provider attributes. Raw recovery
// records remain intact; initial control is not evidence that a ball was won.
export const BALL_WIN_RECOVERY_KINDS=Object.freeze(['goalkeeper-hold','loose-ball','defensive-block','interception']);
export const RECOVERY_KINDS=Object.freeze([...BALL_WIN_RECOVERY_KINDS,'segment-start']);
export const recoveryClassificationVersion='recovery-classification-v1';
export function recoveryClassification(row){
 if(row?.type!=='recovery')return null;
 if(row.recoveryKind==='segment-start')return 'initial-control';
 return BALL_WIN_RECOVERY_KINDS.includes(row.recoveryKind)?'ball-win':'unknown';
}
