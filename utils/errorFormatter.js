export function formatErrorAsJSON(error) {
  const errorDetails = {};
  if (error.code === 'VALIDATION') {
    errorDetails.errors = error.all;
  } else {
    errorDetails.name = error.name;
    errorDetails.message = error.message;
  }
  return errorDetails;
}
}