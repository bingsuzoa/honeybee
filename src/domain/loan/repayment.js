export const REPAYMENT_METHODS = [
  { id: "equal_payment", label: "원리금균등" },
  { id: "equal_principal", label: "원금균등" },
  { id: "graduated_payment", label: "체증식" }
];

export function calculateEqualPayment(principal, annualRate, years) {
  const months = years * 12;
  const monthlyRate = annualRate / 100 / 12;

  if (monthlyRate === 0) {
    const monthlyPayment = principal / months;
    return {
      monthlyPayment,
      firstMonthPayment: monthlyPayment,
      averageMonthlyPayment: monthlyPayment,
      totalRepayment: principal,
      totalInterest: 0
    };
  }

  const power = (1 + monthlyRate) ** months;
  const monthlyPayment = (principal * monthlyRate * power) / (power - 1);
  const totalRepayment = monthlyPayment * months;

  return {
    monthlyPayment,
    firstMonthPayment: monthlyPayment,
    averageMonthlyPayment: monthlyPayment,
    totalRepayment,
    totalInterest: totalRepayment - principal
  };
}

export function calculateEqualPrincipal(principal, annualRate, years) {
  const months = years * 12;
  const monthlyRate = annualRate / 100 / 12;
  const monthlyPrincipal = principal / months;
  let remainingPrincipal = principal;
  let totalRepayment = 0;
  let firstMonthPayment = 0;

  for (let month = 1; month <= months; month += 1) {
    const interest = remainingPrincipal * monthlyRate;
    const payment = monthlyPrincipal + interest;
    if (month === 1) firstMonthPayment = payment;
    totalRepayment += payment;
    remainingPrincipal -= monthlyPrincipal;
  }

  return {
    monthlyPayment: totalRepayment / months,
    firstMonthPayment,
    averageMonthlyPayment: totalRepayment / months,
    totalRepayment,
    totalInterest: totalRepayment - principal
  };
}

export function calculateGraduatedPayment(principal, annualRate, years) {
  const months = years * 12;
  const monthlyRate = annualRate / 100 / 12;
  const growthRate = 0.0015;
  const discountSum = Array.from({ length: months }, (_, index) => {
    const month = index + 1;
    return (1 + growthRate) ** index / (1 + monthlyRate) ** month;
  }).reduce((sum, value) => sum + value, 0);
  const firstMonthPayment = principal / discountSum;
  const lastMonthPayment = firstMonthPayment * (1 + growthRate) ** (months - 1);
  const totalRepayment = Array.from({ length: months }, (_, index) => firstMonthPayment * (1 + growthRate) ** index).reduce(
    (sum, value) => sum + value,
    0
  );

  return {
    monthlyPayment: totalRepayment / months,
    firstMonthPayment,
    lastMonthPayment,
    averageMonthlyPayment: totalRepayment / months,
    totalRepayment,
    totalInterest: totalRepayment - principal
  };
}

export function calculateRepayment(principal, annualRate, years, repaymentType) {
  if (repaymentType === "graduated_payment") {
    return calculateGraduatedPayment(principal, annualRate, years);
  }
  if (repaymentType === "equal_principal") {
    return calculateEqualPrincipal(principal, annualRate, years);
  }
  return calculateEqualPayment(principal, annualRate, years);
}
