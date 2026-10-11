-- 연말정산 계산기 추가: calculator 허용 값에 'yearend' 를 더한다.
alter table shared_results drop constraint shared_results_calculator_check;
alter table shared_results add constraint shared_results_calculator_check
  check (calculator in ('salary', 'payroll', 'insurance', 'freelancer', 'yearend'));

alter table usage_daily drop constraint usage_daily_calculator_check;
alter table usage_daily add constraint usage_daily_calculator_check
  check (calculator in ('salary', 'payroll', 'insurance', 'freelancer', 'yearend', 'table'));

alter table feedback drop constraint feedback_calculator_check;
alter table feedback add constraint feedback_calculator_check
  check (calculator in ('salary', 'payroll', 'insurance', 'freelancer', 'yearend', 'other'));
