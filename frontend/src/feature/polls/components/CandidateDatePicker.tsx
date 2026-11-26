import { Icon } from '../../../components/Icon';
import { DAYS, dateLabel, dayTone, monthCells, shiftedMonth, todayInTokyo } from '../../../lib/date';

export function CandidateDatePicker({ month, dates, onMonth, onToggle, onNext }: {
  month: string; dates: string[]; onMonth: (month: string) => void; onToggle: (date: string) => void; onNext: () => void;
}) {
  const today = todayInTokyo();
  const cells = monthCells(month);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  return <div className="groups-body">
    <p className="hint">候補にしたい日を選んでください。続けて複数の日を選べます。</p>
    <section className="calendar-area" aria-label="候補日を選ぶカレンダー">
      <div className="month-bar">
        <h2 className="month-title"><span className="month-year">{year}年</span><span className="month-number">{monthNumber}<small>月</small></span></h2>
        <div className="month-actions">
          <button type="button" className="icon-btn ghost-btn" aria-label="前の月" onClick={() => onMonth(shiftedMonth(month, -1))}><Icon name="chevronLeft" /><span className="desk-only">前月</span></button>
          <button type="button" className="icon-btn ghost-btn" aria-label="次の月" onClick={() => onMonth(shiftedMonth(month, 1))}><Icon name="chevronRight" /><span className="desk-only">翌月</span></button>
        </div>
      </div>
      <div className="calendar" role="grid" aria-label={`${year}年${monthNumber}月`}>
        <div className="cal-row cal-head" role="row">{DAYS.map((day, i) => <span role="columnheader" key={day} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{day}</span>)}</div>
        {Array.from({ length: cells.length / 7 }, (_, week) => <div className="cal-row" role="row" key={week}>
          {cells.slice(week * 7, week * 7 + 7).map(date => {
            const order = dates.indexOf(date);
            return <button type="button" role="gridcell" key={date} disabled={date < today}
              className={`cal-cell pick-cell ${dayTone(date) ?? ''} ${date.startsWith(month) ? '' : 'outside'}${order >= 0 ? ' picked' : ''}`}
              aria-pressed={order >= 0} aria-label={`${dateLabel(date)}${order >= 0 ? `、候補${order + 1}番目` : ''}`}
              onClick={() => onToggle(date)}>
              <span className="cal-num">{Number(date.slice(8))}</span>
              {order >= 0 && <span className="pick-num" aria-hidden="true">{order + 1}</span>}
            </button>;
          })}
        </div>)}
      </div>
    </section>
    {dates.length > 0 && <ul className="pick-chips" aria-label="選択中の候補日">
      {dates.map((date, i) => <li key={date}><span className="pick-num" aria-hidden="true">{i + 1}</span>{dateLabel(date)}
        <button type="button" aria-label={`${dateLabel(date)}を候補から外す`} onClick={() => onToggle(date)}><Icon name="close" size={14} /></button>
      </li>)}
    </ul>}
    <button type="button" className="primary-btn wide" disabled={!dates.length} onClick={onNext}>
      <Icon name="arrowRight" size={18} />{dates.length ? `${dates.length}日で作成に進む` : '候補日を選んでください'}
    </button>
  </div>;
}
