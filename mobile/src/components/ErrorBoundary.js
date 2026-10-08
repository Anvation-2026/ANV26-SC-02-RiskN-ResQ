import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import ActionButton from './ActionButton';
import { colors, radius, shadow } from '../theme';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (__DEV__) {
      console.warn('ErrorBoundary caught an error:', error, errorInfo);
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.fallbackCard}>
          <View style={styles.header}>
            <Feather name="alert-triangle" size={18} color={colors.HIGH} style={{ marginRight: 8 }} />
            <Text style={styles.title}>{this.props.fallbackTitle || 'Component Unavailable'}</Text>
          </View>
          <Text style={styles.message}>
            {this.props.fallbackMessage || 'An unexpected issue occurred while rendering this section.'}
          </Text>
          <View style={{ marginTop: 10 }}>
            <ActionButton
              variant="primary"
              label="RETRY"
              color={colors.primary}
              onPress={this.resetError}
            />
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallbackCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: radius.card,
    padding: 16,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
    ...shadow,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 14,
    fontFamily: 'PlusJakartaSans_800ExtraBold',
    color: '#991B1B',
  },
  message: {
    fontSize: 12,
    fontFamily: 'PlusJakartaSans_500Medium',
    color: '#7F1D1D',
    lineHeight: 16,
  },
});
