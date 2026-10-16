// Schedule against a monotonic deadline so generating each packet does not add
// its processing time to every second of football. Long stalls do not burst.
export function createStreamCadence(rate, now = () => performance.now()) {
 const interval = 1000 / rate;
 let deadline = now();
 return () => {
  const current = now();
  deadline += interval;
  if (current - deadline >= interval) deadline = current;
  return Math.max(0, deadline - current);
 };
}
