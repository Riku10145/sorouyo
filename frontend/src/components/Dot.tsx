import { type DisplayGroup, groupVars, groupCls } from '../lib/groups';

export const Dot = ({ group }: { group: DisplayGroup }) =>
  <span className={`dot ${groupCls(group)}`} style={groupVars(group)} aria-hidden="true" />;
