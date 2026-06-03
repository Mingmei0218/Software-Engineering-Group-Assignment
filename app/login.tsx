import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function LoginScreen() {
  // 登录 / 注册 两种模式来回切
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSubmit = () => {
    // 前端先做最基础的校验，挡掉空值和密码不一致
    if (!phone || !password) {
      Alert.alert('提示', '请填写账号和密码');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      Alert.alert('提示', '两次输入的密码不一致');
      return;
    }

    // 🔗 后端：下一步在这里调用队友的账号接口——
    //   登录：POST /api/login    { phone, password } → 返回 token
    //   注册：POST /api/register { phone, password } → 返回 token
    //   拿到 token 后存进本地（以后用 expo-secure-store），再 router.back() 回上一页。
    Alert.alert(
      mode === 'login' ? '登录' : '注册',
      '界面已完成 ✅\n实际账号校验需要接入队友的后端接口（🔗）'
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* 登录 / 注册 切换 */}
      <View style={styles.switcher}>
        <TouchableOpacity onPress={() => setMode('login')} activeOpacity={0.7}>
          <Text style={[styles.tab, mode === 'login' && styles.tabActive]}>
            登录
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('register')} activeOpacity={0.7}>
          <Text style={[styles.tab, mode === 'register' && styles.tabActive]}>
            注册
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="手机号 / 邮箱"
          placeholderTextColor="#9CA3AF"
          value={phone}
          onChangeText={setPhone}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="密码"
          placeholderTextColor="#9CA3AF"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {mode === 'register' && (
          <TextInput
            style={styles.input}
            placeholder="确认密码"
            placeholderTextColor="#9CA3AF"
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
          />
        )}

        <TouchableOpacity
          style={styles.submit}
          activeOpacity={0.85}
          onPress={handleSubmit}>
          <Text style={styles.submitText}>
            {mode === 'login' ? '登录' : '注册'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>
        界面已完成；真正的账号校验等接入后端接口后生效。
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7F2', padding: 20 },
  switcher: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 28,
    marginTop: 16,
    marginBottom: 24,
  },
  tab: { fontSize: 18, color: '#9CA3AF', fontWeight: '600', paddingBottom: 4 },
  tabActive: {
    color: '#1F2937',
    borderBottomWidth: 2,
    borderBottomColor: '#3FA34D',
  },
  form: { gap: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 50,
    fontSize: 15,
    color: '#1F2937',
  },
  submit: {
    backgroundColor: '#3FA34D',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  note: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 18,
  },
});
