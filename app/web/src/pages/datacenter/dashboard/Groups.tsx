/**
 * The groups marked on the Physical structure page (site.json pid_notes: a variable standing for several others, e.g.
 * the mean of a rack's CPUs). Only marks: nothing is computed, the data stays as it is; Prepare variables can make one
 * a real column later (combine, with the same method).
 */
import type { Group } from "../structure/notes";

export function Groups({ groups }: { groups: Group[] }) {
  return (
    <>
      <p className="muted dash__note">Marked on the Physical structure page: only marks, no values are computed and the data is not changed.</p>
      <table className="dash-table">
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Method</th>
            <th scope="col">Members</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.name}>
              <th scope="row" className="mono dash-table__name">
                {g.name}
              </th>
              <td>{g.method}</td>
              <td className="mono dash-table__name" style={{ overflowWrap: "anywhere" }}>
                {g.members.length}: {g.members.join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
